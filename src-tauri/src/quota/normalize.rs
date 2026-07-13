use anyhow::{anyhow, Result};
use chrono::{SecondsFormat, TimeZone, Utc};
use serde_json::Value;

use super::types::{QuotaSnapshot, QuotaWindow, ResetCredits};

const RESET_CREDIT_EXPIRY_LIMIT: usize = 5;
const FIVE_HOUR_WINDOW_MINS: u64 = 300;
const WEEKLY_WINDOW_MINS: u64 = 10_080;

pub fn normalize_rate_limits_response(response: &Value) -> Result<QuotaSnapshot> {
    let snapshot = select_snapshot(response).ok_or_else(|| anyhow!("Codex CLI 未返回额度快照。"))?;
    Ok(normalize_snapshot(response, snapshot))
}

fn normalize_snapshot(response: &Value, snapshot: &Value) -> QuotaSnapshot {
    let (primary, secondary) = normalize_windows(snapshot);
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

fn normalize_windows(snapshot: &Value) -> (Option<QuotaWindow>, Option<QuotaWindow>) {
    // 新版 App Server 会把周窗口放到原始 primary；先按时长归位，未知时长才沿用旧位置。
    let raw_primary = normalize_window(snapshot.get("primary"));
    let raw_secondary = normalize_window(snapshot.get("secondary"));
    let mut primary = None;
    let mut secondary = None;
    let mut primary_fallback = None;
    let mut secondary_fallback = None;

    classify_window(
        raw_primary,
        &mut primary,
        &mut secondary,
        &mut primary_fallback,
    );
    classify_window(
        raw_secondary,
        &mut primary,
        &mut secondary,
        &mut secondary_fallback,
    );

    (
        primary.or(primary_fallback),
        secondary.or(secondary_fallback),
    )
}

fn classify_window(
    window: Option<QuotaWindow>,
    primary: &mut Option<QuotaWindow>,
    secondary: &mut Option<QuotaWindow>,
    positional_fallback: &mut Option<QuotaWindow>,
) {
    let Some(window) = window else {
        return;
    };

    match window.window_duration_mins {
        Some(FIVE_HOUR_WINDOW_MINS) => {
            if primary.is_none() {
                *primary = Some(window);
            }
        }
        Some(WEEKLY_WINDOW_MINS) => {
            if secondary.is_none() {
                *secondary = Some(window);
            }
        }
        _ => *positional_fallback = Some(window),
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
    let window_duration_mins = read_u64(window, "windowDurationMins");
    let resets_at = read_unix_seconds(window, "resetsAt").and_then(format_unix_seconds);
    if used_percent == 0 && window_duration_mins.is_none() && resets_at.is_none() {
        return None;
    }

    Some(QuotaWindow {
        used_percent,
        remaining_percent: clamp_percent(100.0 - f64::from(used_percent)),
        window_duration_mins,
        resets_at,
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
        // None 表示旧版 App Server 未提供详情，前端需回退现有 HTTP 接口。
        expiries: normalize_reset_credit_expiries(value),
    })
}

fn normalize_reset_credit_expiries(value: &Value) -> Option<Vec<String>> {
    let credits = value.get("credits")?.as_array()?;
    let mut expiries = credits
        .iter()
        .filter_map(|credit| read_unix_seconds(credit, "expiresAt").and_then(format_unix_seconds))
        .collect::<Vec<_>>();
    expiries.sort();
    expiries.truncate(RESET_CREDIT_EXPIRY_LIMIT);
    Some(expiries)
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
    fn 新版周窗口从原始_primary_映射到_secondary() {
        let response = json!({
            "rateLimits": {
                "primary": {
                    "usedPercent": 2,
                    "windowDurationMins": 10080,
                    "resetsAt": 1710000000
                },
                "secondary": {
                    "usedPercent": 0,
                    "windowDurationMins": null,
                    "resetsAt": null
                }
            }
        });

        let snapshot = normalize_rate_limits_response(&response).unwrap();
        let secondary = snapshot.secondary.unwrap();

        assert_eq!(snapshot.primary, None);
        assert_eq!(secondary.window_duration_mins, Some(WEEKLY_WINDOW_MINS));
        assert_eq!(secondary.remaining_percent, 98);
        assert_eq!(
            secondary.resets_at,
            Some("2024-03-09T16:00:00.000Z".to_string())
        );
        assert_eq!(snapshot.remaining_percent, Some(98));
    }

    #[test]
    fn 旧版双窗口保持五小时和周窗口语义() {
        let response = json!({
            "rateLimits": {
                "primary": { "usedPercent": 20, "windowDurationMins": 300 },
                "secondary": { "usedPercent": 10, "windowDurationMins": 10080 }
            }
        });

        let snapshot = normalize_rate_limits_response(&response).unwrap();

        assert_eq!(
            snapshot.primary.unwrap().window_duration_mins,
            Some(FIVE_HOUR_WINDOW_MINS)
        );
        assert_eq!(
            snapshot.secondary.unwrap().window_duration_mins,
            Some(WEEKLY_WINDOW_MINS)
        );
    }

    #[test]
    fn 原始窗口顺序互换时仍按时长归位() {
        let response = json!({
            "rateLimits": {
                "primary": { "usedPercent": 10, "windowDurationMins": 10080 },
                "secondary": { "usedPercent": 20, "windowDurationMins": 300 }
            }
        });

        let snapshot = normalize_rate_limits_response(&response).unwrap();

        assert_eq!(snapshot.primary.unwrap().remaining_percent, 80);
        assert_eq!(snapshot.secondary.unwrap().remaining_percent, 90);
    }

    #[test]
    fn 无时长有效窗口按原始位置回退() {
        let response = json!({
            "rateLimits": {
                "primary": { "usedPercent": 25, "resetsAt": 1710000000 },
                "secondary": { "usedPercent": 50, "resetsAt": 1710003600 }
            }
        });

        let snapshot = normalize_rate_limits_response(&response).unwrap();

        assert_eq!(snapshot.primary.unwrap().remaining_percent, 75);
        assert_eq!(snapshot.secondary.unwrap().remaining_percent, 50);
    }

    #[test]
    fn 周窗口无重置时间时仍保留周额度() {
        let response = json!({
            "rateLimits": {
                "primary": {
                    "usedPercent": 0,
                    "windowDurationMins": 10080,
                    "resetsAt": null
                }
            }
        });

        let snapshot = normalize_rate_limits_response(&response).unwrap();
        let secondary = snapshot.secondary.unwrap();

        assert_eq!(snapshot.primary, None);
        assert_eq!(secondary.remaining_percent, 100);
        assert_eq!(secondary.resets_at, None);
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
    fn 解析_app_server_重置次数过期时间() {
        let response = json!({
            "rateLimitResetCredits": {
                "availableCount": 7,
                "credits": [
                    { "expiresAt": 1710000300 },
                    { "expiresAt": null },
                    { "expiresAt": 1710000000 },
                    { "expiresAt": "1710000060" },
                    { "expiresAt": 1710000120 },
                    { "expiresAt": 1710000180 },
                    { "expiresAt": 1710000240 }
                ]
            },
            "rateLimits": {
                "primary": { "usedPercent": 12, "windowDurationMins": 300 }
            }
        });

        let reset_credits = normalize_rate_limits_response(&response)
            .unwrap()
            .reset_credits
            .unwrap();

        assert_eq!(reset_credits.expiries.as_ref().unwrap().len(), 5);
        assert_eq!(
            reset_credits.expiries.as_ref().unwrap().first().unwrap(),
            "2024-03-09T16:00:00.000Z"
        );
        assert_eq!(
            reset_credits.expiries.as_ref().unwrap().last().unwrap(),
            "2024-03-09T16:04:00.000Z"
        );
    }

    #[test]
    fn 区分旧版缺失详情与新版空详情() {
        let old_response = json!({
            "rateLimitResetCredits": { "availableCount": 3 },
            "rateLimits": { "primary": { "usedPercent": 12 } }
        });
        let new_response = json!({
            "rateLimitResetCredits": { "availableCount": 0, "credits": [] },
            "rateLimits": { "primary": { "usedPercent": 12 } }
        });

        let old_reset_credits = normalize_rate_limits_response(&old_response)
            .unwrap()
            .reset_credits
            .unwrap();
        let new_reset_credits = normalize_rate_limits_response(&new_response)
            .unwrap()
            .reset_credits
            .unwrap();

        assert_eq!(old_reset_credits.expiries, None);
        assert_eq!(new_reset_credits.expiries, Some(Vec::new()));
    }

    #[test]
    fn 缺失快照时返回错误() {
        let response = json!({});
        let error = normalize_rate_limits_response(&response).unwrap_err();
        assert!(error.to_string().contains("未返回额度快照"));
    }
}
