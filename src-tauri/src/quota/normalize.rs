use anyhow::{anyhow, Result};
use chrono::{SecondsFormat, TimeZone, Utc};
use serde_json::Value;

use super::types::{QuotaSnapshot, QuotaWindow, ResetCredits};

pub fn normalize_rate_limits_response(response: &Value) -> Result<QuotaSnapshot> {
    let snapshot = select_snapshot(response).ok_or_else(|| anyhow!("Codex CLI 未返回额度快照。"))?;
    Ok(normalize_snapshot(response, snapshot))
}

fn normalize_snapshot(response: &Value, snapshot: &Value) -> QuotaSnapshot {
    let primary = normalize_window(snapshot.get("primary"));
    let secondary = normalize_window(snapshot.get("secondary"));
    let active_window = primary.as_ref().or(secondary.as_ref());
    let remaining_percent = active_window.map(|window| window.remaining_percent);
    let used_percent = active_window.map(|window| window.used_percent);
    let resets_at = active_window.and_then(|window| window.resets_at.clone());

    QuotaSnapshot {
        limit_id: read_string(snapshot, "limitId").unwrap_or_else(|| "codex".to_string()),
        limit_name: read_string(snapshot, "limitName").unwrap_or_else(|| "Codex".to_string()),
        plan_type: read_string(snapshot, "planType").unwrap_or_else(|| "unknown".to_string()),
        reached_type: read_string(snapshot, "rateLimitReachedType"),
        credits: snapshot.get("credits").cloned(),
        reset_credits: normalize_reset_credits_from_response(response, snapshot),
        primary,
        secondary,
        remaining_percent,
        used_percent,
        resets_at,
        fetched_at: Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
    }
}

fn select_snapshot(response: &Value) -> Option<&Value> {
    response
        .get("rateLimitsByLimitId")
        .and_then(|value| value.get("codex"))
        .or_else(|| response.get("rateLimits"))
        .or_else(|| first_snapshot(response.get("rateLimitsByLimitId")))
}

fn first_snapshot(map: Option<&Value>) -> Option<&Value> {
    map.and_then(|value| value.as_object())
        .and_then(|object| object.values().next())
}

fn normalize_window(window: Option<&Value>) -> Option<QuotaWindow> {
    let window = window?;
    let used_percent = clamp_percent(read_number(window, "usedPercent").unwrap_or(0.0));
    Some(QuotaWindow {
        used_percent,
        remaining_percent: clamp_percent(100.0 - f64::from(used_percent)),
        window_duration_mins: read_u64(window, "windowDurationMins"),
        resets_at: read_unix_seconds(window, "resetsAt").and_then(format_unix_seconds),
    })
}

fn normalize_reset_credits_from_response(response: &Value, snapshot: &Value) -> Option<ResetCredits> {
    normalize_reset_credits(response.get("rateLimitResetCredits"))
        .or_else(|| normalize_reset_credits(snapshot.get("rateLimitResetCredits")))
}

fn normalize_reset_credits(value: Option<&Value>) -> Option<ResetCredits> {
    let value = value?;
    read_u64(value, "availableCount").map(|available_count| ResetCredits {
        available_count: Some(available_count),
    })
}

fn clamp_percent(value: f64) -> u8 {
    if !value.is_finite() {
        return 0;
    }
    value.round().clamp(0.0, 100.0) as u8
}

fn read_string(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(|item| match item {
        Value::String(text) if !text.trim().is_empty() => Some(text.clone()),
        _ => None,
    })
}

fn read_number(value: &Value, key: &str) -> Option<f64> {
    value.get(key).and_then(|item| match item {
        Value::Number(number) => number.as_f64(),
        Value::String(text) => text.parse::<f64>().ok(),
        _ => None,
    })
}

fn read_u64(value: &Value, key: &str) -> Option<u64> {
    value.get(key).and_then(|item| match item {
        Value::Number(number) => number.as_u64(),
        Value::String(text) => text.parse::<u64>().ok(),
        _ => None,
    })
}

fn read_unix_seconds(value: &Value, key: &str) -> Option<i64> {
    value.get(key).and_then(|item| match item {
        Value::Number(number) => number.as_i64(),
        Value::String(text) => text.parse::<i64>().ok(),
        _ => None,
    })
}

fn format_unix_seconds(seconds: i64) -> Option<String> {
    Utc.timestamp_opt(seconds, 0)
        .single()
        .map(|date| date.to_rfc3339_opts(SecondsFormat::Millis, true))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn 优先选择_codex_额度快照() {
        let response = json!({
            "rateLimitsByLimitId": {
                "other": { "limitId": "other" },
                "codex": {
                    "limitId": "codex",
                    "primary": { "usedPercent": 26, "windowDurationMins": 300 }
                }
            }
        });

        let snapshot = normalize_rate_limits_response(&response).unwrap();
        assert_eq!(snapshot.limit_id, "codex");
        assert_eq!(snapshot.remaining_percent, Some(74));
    }

    #[test]
    fn 缺少_codex_时回退到首个快照() {
        let response = json!({
            "rateLimitsByLimitId": {
                "gpt": {
                    "limitId": "gpt",
                    "primary": { "usedPercent": 9.4, "windowDurationMins": 300 }
                }
            }
        });

        let snapshot = normalize_rate_limits_response(&response).unwrap();
        assert_eq!(snapshot.limit_id, "gpt");
        assert_eq!(snapshot.used_percent, Some(9));
        assert_eq!(snapshot.remaining_percent, Some(91));
    }

    #[test]
    fn 百分比会进行边界限制() {
        let response = json!({
            "rateLimits": {
                "primary": { "usedPercent": 140, "windowDurationMins": 300 },
                "secondary": { "usedPercent": -12, "windowDurationMins": 10080 }
            }
        });

        let snapshot = normalize_rate_limits_response(&response).unwrap();
        assert_eq!(snapshot.primary.unwrap().used_percent, 100);
        assert_eq!(snapshot.remaining_percent, Some(0));
    }

    #[test]
    fn 支持字符串格式的数值字段() {
        let response = json!({
            "rateLimits": {
                "primary": {
                    "usedPercent": "7.6",
                    "windowDurationMins": "300",
                    "resetsAt": "1710000000"
                }
            }
        });

        let snapshot = normalize_rate_limits_response(&response).unwrap();
        let primary = snapshot.primary.unwrap();
        assert_eq!(primary.used_percent, 8);
        assert_eq!(primary.remaining_percent, 92);
        assert_eq!(primary.window_duration_mins, Some(300));
        assert_eq!(
            primary.resets_at,
            Some("2024-03-09T16:00:00.000Z".to_string())
        );
    }

    #[test]
    fn 优先解析根层剩余重置次数() {
        let response = json!({
            "rateLimitResetCredits": { "availableCount": 2 },
            "rateLimits": {
                "rateLimitResetCredits": { "availableCount": 3 },
                "primary": { "usedPercent": 12, "windowDurationMins": 300 }
            }
        });

        let snapshot = normalize_rate_limits_response(&response).unwrap();
        assert_eq!(snapshot.reset_credits.unwrap().available_count, Some(2));
    }

    #[test]
    fn 根层缺失时回退到快照内重置次数() {
        let response = json!({
            "rateLimits": {
                "rateLimitResetCredits": { "availableCount": 3 },
                "primary": { "usedPercent": 12, "windowDurationMins": 300 }
            }
        });

        let snapshot = normalize_rate_limits_response(&response).unwrap();
        assert_eq!(snapshot.reset_credits.unwrap().available_count, Some(3));
    }

    #[test]
    fn 重置次数为零时保留() {
        let response = json!({
            "rateLimitResetCredits": { "availableCount": 0 },
            "rateLimits": {
                "primary": { "usedPercent": 12, "windowDurationMins": 300 }
            }
        });

        let snapshot = normalize_rate_limits_response(&response).unwrap();
        assert_eq!(snapshot.reset_credits.unwrap().available_count, Some(0));
    }

    #[test]
    fn 重置次数缺失或类型异常时为空() {
        let response = json!({
            "rateLimitResetCredits": { "availableCount": -1 },
            "rateLimits": {
                "primary": { "usedPercent": 12, "windowDurationMins": 300 }
            }
        });

        let snapshot = normalize_rate_limits_response(&response).unwrap();
        assert_eq!(snapshot.reset_credits, None);
    }

    #[test]
    fn 缺失快照时返回错误() {
        let response = json!({});
        let error = normalize_rate_limits_response(&response).unwrap_err();
        assert!(error.to_string().contains("未返回额度快照"));
    }
}
