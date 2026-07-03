use std::fs;
use std::path::PathBuf;
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use chrono::{DateTime, SecondsFormat, Utc};
use reqwest::header::{ACCEPT, ORIGIN, REFERER};
use serde::Deserialize;
use serde_json::Value;

use super::types::ResetCreditExpiries;

const RESET_CREDIT_EXPIRIES_URL: &str =
    "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits";
const RESET_CREDIT_EXPIRY_LIMIT: usize = 5;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(8);

#[derive(Debug, Deserialize)]
struct AuthFile {
    tokens: AuthTokens,
}

#[derive(Debug, Deserialize)]
struct AuthTokens {
    access_token: String,
}

pub async fn fetch_reset_credit_expiries(
    update_proxy: Option<&str>,
) -> Result<ResetCreditExpiries> {
    let token = read_access_token()?;
    let client = create_client(update_proxy)?;
    let response = client
        .get(RESET_CREDIT_EXPIRIES_URL)
        .header(ACCEPT, "application/json")
        .header(ORIGIN, "https://chatgpt.com")
        .header(REFERER, "https://chatgpt.com/")
        .bearer_auth(token)
        .send()
        .await
        .context("请求重置次数过期时间失败")?
        .error_for_status()
        .context("重置次数过期时间接口返回失败状态")?;
    let body = response
        .text()
        .await
        .context("读取重置次数过期时间响应失败")?;
    let value = serde_json::from_str::<Value>(&body).context("解析重置次数过期时间响应失败")?;

    Ok(ResetCreditExpiries {
        expiries: parse_reset_credit_expiries(&value),
    })
}

fn create_client(update_proxy: Option<&str>) -> Result<reqwest::Client> {
    let mut builder = reqwest::Client::builder().timeout(REQUEST_TIMEOUT);
    if let Some(proxy) = update_proxy
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        // 与自动更新共用代理配置，避免额外增加一套网络设置。
        builder =
            builder.proxy(reqwest::Proxy::all(proxy).context("重置次数过期时间代理配置无效")?);
    }
    builder
        .build()
        .context("创建重置次数过期时间 HTTP 客户端失败")
}

fn read_access_token() -> Result<String> {
    let path = auth_file_path()?;
    let text = fs::read_to_string(&path)
        .with_context(|| format!("无法读取 Codex 登录文件：{}", path.display()))?;
    let auth = serde_json::from_str::<AuthFile>(&text).context("Codex 登录文件解析失败")?;
    let token = auth.tokens.access_token.trim().to_string();
    if token.is_empty() {
        return Err(anyhow!("Codex 登录文件缺少 access_token。"));
    }
    Ok(token)
}

fn auth_file_path() -> Result<PathBuf> {
    if let Some(path) = non_empty_env_path("CODEX_HOME") {
        return Ok(path.join("auth.json"));
    }
    let home = non_empty_env_path("USERPROFILE")
        .or_else(|| non_empty_env_path("HOME"))
        .ok_or_else(|| anyhow!("无法解析用户目录以读取 Codex 登录文件。"))?;
    Ok(home.join(".codex").join("auth.json"))
}

fn non_empty_env_path(name: &str) -> Option<PathBuf> {
    std::env::var_os(name).and_then(|value| {
        if value.is_empty() {
            None
        } else {
            Some(PathBuf::from(value))
        }
    })
}

fn parse_reset_credit_expiries(value: &Value) -> Vec<String> {
    let mut expiries = value
        .get("credits")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|credit| credit.get("expires_at").and_then(Value::as_str))
        .filter_map(parse_expiry)
        .collect::<Vec<_>>();
    expiries.sort();
    expiries.truncate(RESET_CREDIT_EXPIRY_LIMIT);
    expiries
        .into_iter()
        .map(|date| date.to_rfc3339_opts(SecondsFormat::Secs, true))
        .collect()
}

fn parse_expiry(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value.trim())
        .ok()
        .map(|date| date.with_timezone(&Utc))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn 过期时间按升序且最多五个() {
        let value = json!({
            "available_count": 9,
            "credits": [
                { "expires_at": "2026-07-10T00:00:00Z" },
                { "expires_at": "bad" },
                { "expires_at": "2026-07-05T00:00:00Z" },
                { "expires_at": "2026-07-06T00:00:00Z" },
                { "expires_at": "2026-07-07T00:00:00Z" },
                { "expires_at": "2026-07-08T00:00:00Z" },
                { "expires_at": "2026-07-09T00:00:00Z" },
                { "expires_at": "2026-07-11T00:00:00Z" },
                { "expires_at": "2026-07-12T00:00:00Z" }
            ]
        });

        let expiries = parse_reset_credit_expiries(&value);

        assert_eq!(expiries.len(), 5);
        assert_eq!(expiries.first().unwrap(), "2026-07-05T00:00:00Z");
        assert_eq!(expiries.last().unwrap(), "2026-07-09T00:00:00Z");
    }

    #[test]
    fn 缺失或异常字段返回空列表() {
        assert!(parse_reset_credit_expiries(&json!({})).is_empty());
        assert!(parse_reset_credit_expiries(&json!({ "credits": null })).is_empty());
        assert!(
            parse_reset_credit_expiries(&json!({ "credits": [{ "expires_at": 1 }] })).is_empty()
        );
    }
}
