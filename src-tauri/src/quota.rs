use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use std::{fs, time::SystemTime};

use anyhow::{anyhow, Context, Result};
use chrono::{SecondsFormat, TimeZone, Utc};
use serde::Serialize;
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader, Lines};
use tokio::process::{Child, ChildStderr, ChildStdin, ChildStdout, Command};
use tokio::sync::Mutex;
use tokio::task::JoinHandle;
use tokio::time::timeout;

const DEFAULT_TIMEOUT: Duration = Duration::from_secs(12);
const STDERR_TAIL_LIMIT: usize = 4096;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

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

pub struct QuotaService {
    session: Option<CodexSession>,
    // 最近成功快照是后端侧的稳定状态，刷新失败和会话失效都不能清掉它。
    last_success: Option<QuotaSnapshot>,
}

impl QuotaService {
    pub fn new() -> Self {
        Self {
            session: None,
            last_success: None,
        }
    }

    pub async fn get_quota(&mut self, codex_cli_path: Option<&Path>) -> Result<QuotaSnapshot> {
        match self.read_and_remember_quota(codex_cli_path).await {
            Ok(snapshot) => Ok(snapshot),
            Err(first_error) => {
                self.retry_with_fresh_session(first_error, codex_cli_path)
                    .await
            }
        }
    }

    async fn retry_with_fresh_session(
        &mut self,
        first_error: anyhow::Error,
        codex_cli_path: Option<&Path>,
    ) -> Result<QuotaSnapshot> {
        // 长连接一旦读写失败就不能假设仍可复用，先清理再启动新会话重试一次。
        self.invalidate_session().await;

        match self.read_and_remember_quota(codex_cli_path).await {
            Ok(snapshot) => Ok(snapshot),
            Err(second_error) => {
                self.invalidate_session().await;
                Err(anyhow!(
                    "Codex 会话重启后仍读取失败：{second_error}；首次错误：{first_error}"
                ))
            }
        }
    }

    async fn read_and_remember_quota(
        &mut self,
        codex_cli_path: Option<&Path>,
    ) -> Result<QuotaSnapshot> {
        let snapshot = self.read_quota_with_session(codex_cli_path).await?;
        self.remember_success(&snapshot);
        Ok(snapshot)
    }

    async fn read_quota_with_session(
        &mut self,
        codex_cli_path: Option<&Path>,
    ) -> Result<QuotaSnapshot> {
        let codex_command = resolve_codex_command(codex_cli_path);
        if self
            .session
            .as_ref()
            .is_some_and(|session| session.codex_command() != codex_command.as_path())
        {
            self.invalidate_session().await;
        }

        if self.session.is_none() {
            self.session = Some(CodexSession::start(codex_command).await?);
        }

        let session = self
            .session
            .as_mut()
            .ok_or_else(|| anyhow!("Codex 会话未初始化。"))?;
        let response = match session.read_rate_limits().await {
            Ok(response) => response,
            Err(error) => {
                let stderr = session.stderr_tail().await;
                return Err(enrich_error_with_stderr(error, stderr));
            }
        };
        normalize_rate_limits_response(&response).context("Codex 额度响应解析失败")
    }

    pub async fn reset_session(&mut self) {
        self.invalidate_session().await;
    }

    async fn invalidate_session(&mut self) {
        if let Some(session) = self.session.take() {
            session.shutdown().await;
        }
    }

    fn remember_success(&mut self, snapshot: &QuotaSnapshot) {
        self.last_success = Some(snapshot.clone());
    }

    #[cfg(test)]
    fn last_success(&self) -> Option<&QuotaSnapshot> {
        self.last_success.as_ref()
    }
}

impl Default for QuotaService {
    fn default() -> Self {
        Self::new()
    }
}

pub fn resolve_codex_command(codex_cli_path: Option<&Path>) -> PathBuf {
    if let Some(path) = codex_cli_path {
        return path.to_path_buf();
    }

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

struct CodexSession {
    codex_command: PathBuf,
    child: Child,
    stdin: ChildStdin,
    lines: Lines<BufReader<ChildStdout>>,
    next_request_id: u64,
    stderr_tail: Arc<Mutex<String>>,
    stderr_task: JoinHandle<()>,
}

impl CodexSession {
    async fn start(codex_command: PathBuf) -> Result<Self> {
        let mut command = Command::new(&codex_command);
        command
            .args(["app-server", "--listen", "stdio://"])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true);
        hide_background_process_window(&mut command);

        let mut child = command
            .spawn()
            .with_context(|| format!("无法启动 Codex CLI：{}", codex_command.display()))?;

        let stdin = child
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

        let stderr_tail = Arc::new(Mutex::new(String::new()));
        let stderr_task = spawn_stderr_tail_task(stderr, Arc::clone(&stderr_tail));
        let mut session = Self {
            codex_command,
            child,
            stdin,
            lines: BufReader::new(stdout).lines(),
            next_request_id: 1,
            stderr_tail,
            stderr_task,
        };

        if let Err(error) = session.initialize().await {
            let stderr = session.stderr_tail().await;
            let error = enrich_error_with_stderr(error, stderr);
            session.shutdown().await;
            return Err(error);
        }

        Ok(session)
    }

    fn codex_command(&self) -> &Path {
        &self.codex_command
    }

    async fn initialize(&mut self) -> Result<()> {
        let request_id = self.next_request_id();
        send_request(
            &mut self.stdin,
            request_id,
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
        .await
        .context("Codex 初始化请求发送失败")?;
        let _ = read_response(&mut self.lines, request_id, "initialize")
            .await
            .context("Codex 初始化失败")?;
        Ok(())
    }

    async fn read_rate_limits(&mut self) -> Result<Value> {
        let request_id = self.next_request_id();
        send_request(&mut self.stdin, request_id, "account/rateLimits/read", None)
            .await
            .context("Codex 额度请求发送失败")?;
        read_response(&mut self.lines, request_id, "account/rateLimits/read")
            .await
            .context("Codex 额度读取失败")
    }

    fn next_request_id(&mut self) -> u64 {
        take_next_request_id(&mut self.next_request_id)
    }

    async fn stderr_tail(&self) -> String {
        self.stderr_tail.lock().await.trim().to_string()
    }

    async fn shutdown(mut self) {
        cleanup_child(&mut self.child).await;
        self.stderr_task.abort();
        let _ = self.stderr_task.await;
    }
}

#[cfg(windows)]
fn hide_background_process_window(command: &mut Command) {
    // 后台额度读取只通过 stdio 通信，不需要让 Codex CLI 创建可见控制台窗口。
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn hide_background_process_window(_command: &mut Command) {}

fn spawn_stderr_tail_task(stderr: ChildStderr, stderr_tail: Arc<Mutex<String>>) -> JoinHandle<()> {
    tokio::spawn(async move {
        let mut reader = BufReader::new(stderr);
        let mut buffer = [0u8; 1024];

        loop {
            match reader.read(&mut buffer).await {
                Ok(0) => break,
                Ok(size) => {
                    let chunk = String::from_utf8_lossy(&buffer[..size]);
                    append_stderr_tail(&stderr_tail, &chunk).await;
                }
                Err(_) => break,
            }
        }
    })
}

async fn append_stderr_tail(stderr_tail: &Arc<Mutex<String>>, chunk: &str) {
    let mut text = stderr_tail.lock().await;
    text.push_str(chunk);
    trim_text_tail(&mut text, STDERR_TAIL_LIMIT);
}

fn trim_text_tail(text: &mut String, limit: usize) {
    if text.chars().count() <= limit {
        return;
    }

    let tail = text
        .chars()
        .rev()
        .take(limit)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    *text = tail;
}

fn enrich_error_with_stderr(error: anyhow::Error, stderr: String) -> anyhow::Error {
    if stderr.is_empty() {
        error
    } else {
        anyhow!("{error}；Codex 错误输出：{stderr}")
    }
}

fn take_next_request_id(next_request_id: &mut u64) -> u64 {
    let request_id = *next_request_id;
    *next_request_id = (*next_request_id).saturating_add(1);
    request_id
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

    #[test]
    fn 请求_id_会递增() {
        let mut next_request_id = 1;

        assert_eq!(take_next_request_id(&mut next_request_id), 1);
        assert_eq!(take_next_request_id(&mut next_request_id), 2);
        assert_eq!(next_request_id, 3);
    }

    #[test]
    fn stderr_尾部只保留限定长度() {
        let mut text = "一二三四五".to_string();

        trim_text_tail(&mut text, 3);

        assert_eq!(text, "三四五");
    }

    #[tokio::test]
    async fn 会话失效不会清空最近成功快照() {
        let snapshot = normalize_rate_limits_response(&json!({
            "rateLimits": {
                "primary": { "usedPercent": 12, "windowDurationMins": 300 }
            }
        }))
        .unwrap();
        let mut service = QuotaService::new();
        service.remember_success(&snapshot);

        service.invalidate_session().await;

        assert_eq!(service.last_success(), Some(&snapshot));
    }
}
