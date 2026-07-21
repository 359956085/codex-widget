use std::path::Path;

use anyhow::{anyhow, Context, Result};
use serde_json::Value;

use super::command::resolve_codex_command;
use super::normalize::normalize_rate_limits_response;
use super::session::{enrich_error_with_stderr, CodexSession};
use super::types::QuotaSnapshot;

enum SessionReadFailure {
    Transport(anyhow::Error),
    Protocol(anyhow::Error),
}

pub struct QuotaService {
    session: Option<CodexSession>,
}

impl QuotaService {
    pub fn new() -> Self {
        Self { session: None }
    }

    pub async fn get_quota(&mut self, codex_cli_path: Option<&Path>) -> Result<QuotaSnapshot> {
        let response = match self.read_rate_limits_with_session(codex_cli_path).await {
            Ok(response) => response,
            Err(SessionReadFailure::Transport(first_error)) => {
                self.retry_with_fresh_session(first_error, codex_cli_path)
                    .await?
            }
            Err(SessionReadFailure::Protocol(error)) => return Err(error),
        };
        // 响应结构错误不会因重启进程而改变，只对会话传输错误重试。
        normalize_quota_response(&response)
    }

    async fn retry_with_fresh_session(
        &mut self,
        first_error: anyhow::Error,
        codex_cli_path: Option<&Path>,
    ) -> Result<Value> {
        // 长连接一旦读写失败就不能假设仍可复用，先清理再启动新会话重试一次。
        self.invalidate_session().await;

        match self.read_rate_limits_with_session(codex_cli_path).await {
            Ok(response) => Ok(response),
            Err(SessionReadFailure::Protocol(error)) => Err(error),
            Err(SessionReadFailure::Transport(second_error)) => {
                self.invalidate_session().await;
                Err(anyhow!(
                    "Codex CLI app-server 会话重启后仍读取失败：{second_error}；首次错误：{first_error}"
                ))
            }
        }
    }

    async fn read_rate_limits_with_session(
        &mut self,
        codex_cli_path: Option<&Path>,
    ) -> Result<Value, SessionReadFailure> {
        let codex_command = resolve_codex_command(codex_cli_path);
        if self
            .session
            .as_ref()
            .is_some_and(|session| session.codex_command() != codex_command.as_path())
        {
            self.invalidate_session().await;
        }

        if self.session.is_none() {
            self.session = Some(
                CodexSession::start(codex_command)
                    .await
                    .map_err(SessionReadFailure::Transport)?,
            );
        }

        let session = self.session.as_mut().ok_or_else(|| {
            SessionReadFailure::Transport(anyhow!("Codex CLI app-server 会话未初始化。"))
        })?;
        match session.read_rate_limits().await {
            Ok(response) => Ok(response),
            Err(error) => {
                let is_transport = error.is_transport();
                let stderr = session.stderr_tail().await;
                let error = enrich_error_with_stderr(error.into_error(), stderr);
                if is_transport {
                    Err(SessionReadFailure::Transport(error))
                } else {
                    Err(SessionReadFailure::Protocol(error))
                }
            }
        }
    }

    pub async fn reset_session(&mut self) {
        self.invalidate_session().await;
    }

    async fn invalidate_session(&mut self) {
        if let Some(session) = self.session.take() {
            session.shutdown().await;
        }
    }
}

fn normalize_quota_response(response: &Value) -> Result<QuotaSnapshot> {
    normalize_rate_limits_response(response).context("Codex CLI 额度响应解析失败")
}

impl Default for QuotaService {
    fn default() -> Self {
        Self::new()
    }
}

//noinspection NonAsciiCharacters
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn 响应结构错误直接返回解析错误() {
        let error = normalize_quota_response(&json!({}))
            .unwrap_err()
            .to_string();

        assert!(error.contains("Codex CLI 额度响应解析失败"));
        assert!(!error.contains("会话重启"));
    }
}
