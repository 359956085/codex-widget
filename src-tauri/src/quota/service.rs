use std::path::Path;

use anyhow::{anyhow, Context, Result};

use super::command::resolve_codex_command;
use super::normalize::normalize_rate_limits_response;
use super::session::{enrich_error_with_stderr, CodexSession};
use super::types::QuotaSnapshot;

pub struct QuotaService {
    session: Option<CodexSession>,
}

impl QuotaService {
    pub fn new() -> Self {
        Self { session: None }
    }

    pub async fn get_quota(&mut self, codex_cli_path: Option<&Path>) -> Result<QuotaSnapshot> {
        match self.read_quota_with_session(codex_cli_path).await {
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

        match self.read_quota_with_session(codex_cli_path).await {
            Ok(snapshot) => Ok(snapshot),
            Err(second_error) => {
                self.invalidate_session().await;
                Err(anyhow!(
                    "Codex CLI app-server 会话重启后仍读取失败：{second_error}；首次错误：{first_error}"
                ))
            }
        }
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
            .ok_or_else(|| anyhow!("Codex CLI app-server 会话未初始化。"))?;
        let response = match session.read_rate_limits().await {
            Ok(response) => response,
            Err(error) => {
                let stderr = session.stderr_tail().await;
                return Err(enrich_error_with_stderr(error, stderr));
            }
        };
        normalize_rate_limits_response(&response).context("Codex CLI 额度响应解析失败")
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

impl Default for QuotaService {
    fn default() -> Self {
        Self::new()
    }
}
