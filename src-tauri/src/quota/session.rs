use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader, Lines};
use tokio::process::{Child, ChildStderr, ChildStdin, ChildStdout, Command};
use tokio::sync::Mutex;
use tokio::task::JoinHandle;
use tokio::time::timeout;

use super::command::hide_background_process_window;

const DEFAULT_TIMEOUT: Duration = Duration::from_secs(12);
const STDERR_TAIL_LIMIT: usize = 4096;

pub(super) struct CodexSession {
    codex_command: PathBuf,
    child: Child,
    stdin: ChildStdin,
    lines: Lines<BufReader<ChildStdout>>,
    next_request_id: u64,
    stderr_tail: Arc<Mutex<String>>,
    stderr_task: JoinHandle<()>,
}

impl CodexSession {
    pub(super) async fn start(codex_command: PathBuf) -> Result<Self> {
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

    pub(super) fn codex_command(&self) -> &Path {
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
                    "title": "Codex CLI 额度小组件",
                    "version": env!("CARGO_PKG_VERSION")
                },
                "capabilities": null
            })),
        )
        .await
        .context("Codex CLI app-server 初始化请求发送失败")?;
        let _ = read_response(&mut self.lines, request_id, "initialize")
            .await
            .context("Codex CLI app-server 初始化失败")?;
        Ok(())
    }

    pub(super) async fn read_rate_limits(&mut self) -> Result<Value> {
        let request_id = self.next_request_id();
        send_request(&mut self.stdin, request_id, "account/rateLimits/read", None)
            .await
            .context("Codex CLI 额度请求发送失败")?;
        read_response(&mut self.lines, request_id, "account/rateLimits/read")
            .await
            .context("Codex CLI 额度读取失败")
    }

    fn next_request_id(&mut self) -> u64 {
        take_next_request_id(&mut self.next_request_id)
    }

    pub(super) async fn stderr_tail(&self) -> String {
        self.stderr_tail.lock().await.trim().to_string()
    }

    pub(super) async fn shutdown(mut self) {
        cleanup_child(&mut self.child).await;
        self.stderr_task.abort();
        let _ = self.stderr_task.await;
    }
}

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

pub(super) fn enrich_error_with_stderr(error: anyhow::Error, stderr: String) -> anyhow::Error {
    if stderr.is_empty() {
        error
    } else {
        anyhow!("{error}；Codex CLI 错误输出：{stderr}")
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
        .map_err(|_| anyhow!("Codex CLI 请求超时：{method}"))?
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
            .ok_or_else(|| anyhow!("Codex CLI 响应缺少 result 字段。"));
    }

    Err(anyhow!("Codex CLI 子进程提前退出。"))
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
}
