use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

use anyhow::{anyhow, Context, Result};
use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
    Off,
    Error,
    Warn,
    Info,
    Debug,
    Trace,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LogWriteOutcome {
    Written,
    Filtered,
}

impl Default for LogLevel {
    fn default() -> Self {
        Self::Off
    }
}

struct LoggerState {
    level: LogLevel,
    path: Option<PathBuf>,
}

pub struct AppLogger {
    state: Mutex<LoggerState>,
}

impl AppLogger {
    pub fn new() -> Self {
        Self {
            state: Mutex::new(LoggerState {
                level: LogLevel::Off,
                path: None,
            }),
        }
    }

    pub fn configure(&self, app: &AppHandle, level: LogLevel) -> Result<()> {
        let path = if level == LogLevel::Off {
            None
        } else {
            Some(
                app.path()
                    .app_config_dir()
                    .context("无法解析应用配置目录。")?
                    .join("logs")
                    .join("codex-widget.log"),
            )
        };

        let mut state = self.state.lock().expect("日志状态锁已损坏");
        state.level = level;
        state.path = path;
        Ok(())
    }

    pub fn write(&self, level: LogLevel, source: &str, message: &str) -> Result<LogWriteOutcome> {
        let Some(path) = self.active_path(level)? else {
            return Ok(LogWriteOutcome::Filtered);
        };

        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .with_context(|| format!("无法创建日志目录：{}", parent.display()))?;
        }

        let timestamp = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
        let source = sanitize_log_text(source);
        let message = sanitize_log_text(message);
        let line = format!("{timestamp} [{}] {source} {message}\n", level.as_label());

        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .with_context(|| format!("无法打开日志文件：{}", path.display()))?;
        file.write_all(line.as_bytes())
            .with_context(|| format!("无法写入日志文件：{}", path.display()))?;
        Ok(LogWriteOutcome::Written)
    }

    pub fn write_best_effort(&self, level: LogLevel, source: &str, message: &str) {
        if let Err(error) = self.write(level, source, message) {
            #[cfg(debug_assertions)]
            eprintln!("写入日志失败：{error:#}");
            #[cfg(not(debug_assertions))]
            let _ = error;
        }
    }

    fn active_path(&self, level: LogLevel) -> Result<Option<PathBuf>> {
        let state = self.state.lock().map_err(|_| anyhow!("日志状态锁已损坏"))?;
        if !should_write(state.level, level) {
            return Ok(None);
        }
        Ok(state.path.clone())
    }

    #[cfg(test)]
    fn configure_path_for_test(&self, level: LogLevel, path: Option<PathBuf>) {
        let mut state = self.state.lock().expect("日志状态锁已损坏");
        state.level = level;
        state.path = path;
    }
}

impl LogLevel {
    fn as_label(self) -> &'static str {
        match self {
            LogLevel::Off => "OFF",
            LogLevel::Error => "ERROR",
            LogLevel::Warn => "WARN",
            LogLevel::Info => "INFO",
            LogLevel::Debug => "DEBUG",
            LogLevel::Trace => "TRACE",
        }
    }

    fn priority(self) -> u8 {
        match self {
            LogLevel::Off => 0,
            LogLevel::Error => 1,
            LogLevel::Warn => 2,
            LogLevel::Info => 3,
            LogLevel::Debug => 4,
            LogLevel::Trace => 5,
        }
    }
}

fn should_write(configured: LogLevel, current: LogLevel) -> bool {
    configured != LogLevel::Off && current != LogLevel::Off && current.priority() <= configured.priority()
}

fn sanitize_log_text(value: &str) -> String {
    redact_url_credentials(value).replace(['\r', '\n'], " ")
}

fn redact_url_credentials(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut rest = value;

    while let Some(scheme_index) = rest.find("://") {
        let (before, after_before) = rest.split_at(scheme_index + 3);
        output.push_str(before);
        let after_scheme = after_before;
        let authority_end = after_scheme
            .find(|ch| ch == '/' || ch == ' ' || ch == '\t')
            .unwrap_or(after_scheme.len());
        let (authority, tail) = after_scheme.split_at(authority_end);
        if let Some(at_index) = authority.rfind('@') {
            output.push_str("***");
            output.push_str(&authority[at_index..]);
        } else {
            output.push_str(authority);
        }
        rest = tail;
    }

    output.push_str(rest);
    output
}

//noinspection NonAsciiCharacters
#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};


    #[test]
    fn off_不创建日志文件() {
        let logger = AppLogger::new();
        let path = temp_test_dir("off").join("codex-widget.log");
        logger.configure_path_for_test(LogLevel::Off, Some(path.clone()));

        let outcome = logger
            .write(LogLevel::Error, "frontend.update", "获取版本失败")
            .unwrap();

        assert_eq!(outcome, LogWriteOutcome::Filtered);
        assert!(!path.exists());
    }

    #[test]
    fn error_等级写入错误日志() {
        let logger = AppLogger::new();
        let path = temp_test_dir("error").join("logs").join("codex-widget.log");
        logger.configure_path_for_test(LogLevel::Error, Some(path.clone()));

        let outcome = logger
            .write(LogLevel::Error, "frontend.update", "获取版本失败")
            .unwrap();

        assert_eq!(outcome, LogWriteOutcome::Written);
        let text = fs::read_to_string(path).unwrap();
        assert!(text.contains("[ERROR] frontend.update 获取版本失败"));
    }

    #[test]
    fn error_等级过滤_debug() {
        let logger = AppLogger::new();
        let path = temp_test_dir("filter-debug").join("codex-widget.log");
        logger.configure_path_for_test(LogLevel::Error, Some(path.clone()));

        let outcome = logger
            .write(LogLevel::Debug, "backend.settings", "设置已保存")
            .unwrap();

        assert_eq!(outcome, LogWriteOutcome::Filtered);
        assert!(!path.exists());
    }

    #[test]
    fn url_认证信息脱敏() {
        let logger = AppLogger::new();
        let path = temp_test_dir("redact").join("codex-widget.log");
        logger.configure_path_for_test(LogLevel::Error, Some(path.clone()));

        logger
            .write(
                LogLevel::Error,
                "frontend.update",
                "代理失败：https://user:pass@example.com:443/path",
            )
            .unwrap();

        let text = fs::read_to_string(path).unwrap();
        assert!(text.contains("https://***@example.com:443/path"));
        assert!(!text.contains("user:pass"));
    }

    fn temp_test_dir(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("codex-widget-logging-{name}-{unique}"))
    }
}
