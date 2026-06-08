use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use std::{fs, time::SystemTime};

use anyhow::{anyhow, Context, Result};
use chrono::{SecondsFormat, TimeZone, Utc};
use serde::Serialize;
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader, Lines};
use tokio::process::{ChildStdout, Command};
use tokio::sync::Mutex;
use tokio::time::timeout;

const DEFAULT_TIMEOUT: Duration = Duration::from_secs(12);

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct QuotaWindow {
    pub used_percent: u8,
    pub remaining_percent: u8,
    pub window_duration_mins: Option<u64>,
    pub resets_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QuotaSnapshot {
    pub limit_id: String,
    pub limit_name: String,
    pub plan_type: String,
    pub reached_type: Option<String>,
    pub credits: Option<Value>,
    pub primary: Option<QuotaWindow>,
    pub secondary: Option<QuotaWindow>,
    pub remaining_percent: Option<u8>,
    pub used_percent: Option<u8>,
    pub resets_at: Option<String>,
    pub fetched_at: String,
}

pub async fn get_quota() -> Result<QuotaSnapshot> {
    let response = request_rate_limits().await?;
    normalize_rate_limits_response(&response)
}

pub fn resolve_codex_command() -> PathBuf {
    let mut candidates = Vec::new();

    if let Ok(path) = std::env::var("CODEX_CLI_PATH") {
        if !path.trim().is_empty() {
            candidates.push(PathBuf::from(path));
        }
    }

    if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        let codex_bin = PathBuf::from(local_app_data)
            .join("OpenAI")
            .join("Codex")
            .join("bin");
        candidates.push(codex_bin.join("codex.exe"));

        if let Some(command) = find_codex_command_in_version_dirs(&codex_bin) {
            candidates.push(command);
        }
    }

    for candidate in candidates {
        if candidate.exists() {
            return candidate;
        }
    }

    PathBuf::from("codex.exe")
}

fn find_codex_command_in_version_dirs(codex_bin: &PathBuf) -> Option<PathBuf> {
    // Codex Windows 版会把 CLI 放在 bin 下的哈希子目录中，不能只检查固定文件名。
    let entries = fs::read_dir(codex_bin).ok()?;
    let mut newest: Option<(SystemTime, PathBuf)> = None;

    for entry in entries.flatten() {
        let candidate = entry.path().join("codex.exe");
        if !candidate.exists() {
            continue;
        }

        let modified_at = candidate
            .metadata()
            .and_then(|metadata| metadata.modified())
            .unwrap_or(SystemTime::UNIX_EPOCH);

        match &newest {
            Some((current_time, _)) if modified_at <= *current_time => {}
            _ => newest = Some((modified_at, candidate)),
        }
    }

    newest.map(|(_, path)| path)
}

pub fn normalize_rate_limits_response(response: &Value) -> Result<QuotaSnapshot> {
    let snapshot = select_snapshot(response).ok_or_else(|| anyhow!("Codex 未返回额度快照。"))?;
    Ok(normalize_snapshot(snapshot))
}

fn normalize_snapshot(snapshot: &Value) -> QuotaSnapshot {
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

async fn request_rate_limits() -> Result<Value> {
    let codex_command = resolve_codex_command();
    let mut child = Command::new(&codex_command)
        .args(["app-server", "--listen", "stdio://"])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .with_context(|| format!("无法启动 Codex CLI：{}", codex_command.display()))?;

    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| anyhow!("无法打开 Codex CLI 输入流。"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| anyhow!("无法打开 Codex CLI 输出流。"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| anyhow!("无法打开 Codex CLI 错误流。"))?;

    let stderr_text = Arc::new(Mutex::new(String::new()));
    let stderr_task_text = Arc::clone(&stderr_text);
    let stderr_task = tokio::spawn(async move {
        let mut reader = BufReader::new(stderr);
        let mut text = String::new();
        let _ = reader.read_to_string(&mut text).await;
        *stderr_task_text.lock().await = text;
    });

    let mut lines = BufReader::new(stdout).lines();

    let result = async {
        send_request(
            &mut stdin,
            1,
            "initialize",
            Some(json!({
                "clientInfo": {
                    "name": "codex-quota-widget-rs",
                    "title": "Codex 额度小组件",
                    "version": env!("CARGO_PKG_VERSION")
                },
                "capabilities": null
            })),
        )
        .await?;
        let _ = read_response(&mut lines, 1, "initialize").await?;

        send_request(&mut stdin, 2, "account/rateLimits/read", None).await?;
        read_response(&mut lines, 2, "account/rateLimits/read").await
    }
    .await;

    cleanup_child(&mut child).await;
    let _ = stderr_task.await;

    match result {
        Ok(value) => Ok(value),
        Err(error) => {
            let stderr = stderr_text.lock().await.trim().to_string();
            if stderr.is_empty() {
                Err(error)
            } else {
                Err(anyhow!("{stderr}"))
            }
        }
    }
}

async fn send_request(
    stdin: &mut tokio::process::ChildStdin,
    id: u64,
    method: &str,
    params: Option<Value>,
) -> Result<()> {
    let payload = match params {
        Some(params) => json!({ "id": id, "method": method, "params": params }),
        None => json!({ "id": id, "method": method }),
    };

    stdin.write_all(payload.to_string().as_bytes()).await?;
    stdin.write_all(b"\n").await?;
    stdin.flush().await?;
    Ok(())
}

async fn read_response(
    lines: &mut Lines<BufReader<ChildStdout>>,
    expected_id: u64,
    method: &str,
) -> Result<Value> {
    timeout(DEFAULT_TIMEOUT, read_matching_response(lines, expected_id))
        .await
        .map_err(|_| anyhow!("Codex 请求超时：{method}"))?
}

async fn read_matching_response(
    lines: &mut Lines<BufReader<ChildStdout>>,
    expected_id: u64,
) -> Result<Value> {
    while let Some(line) = lines.next_line().await? {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        let message: Value = match serde_json::from_str(line) {
            Ok(message) => message,
            Err(_) => continue,
        };

        if message.get("id").and_then(Value::as_u64) != Some(expected_id) {
            continue;
        }

        if let Some(error) = message.get("error") {
            let message = error
                .get("message")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
                .unwrap_or_else(|| error.to_string());
            return Err(anyhow!(message));
        }

        return message
            .get("result")
            .cloned()
            .ok_or_else(|| anyhow!("Codex 响应缺少 result 字段。"));
    }

    Err(anyhow!("Codex 子进程提前退出。"))
}

async fn cleanup_child(child: &mut tokio::process::Child) {
    if child.id().is_some() {
        let _ = child.kill().await;
        let _ = child.wait().await;
    }
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
    fn 缺失快照时返回错误() {
        let response = json!({});
        let error = normalize_rate_limits_response(&response).unwrap_err();
        assert!(error.to_string().contains("未返回额度快照"));
    }
}
