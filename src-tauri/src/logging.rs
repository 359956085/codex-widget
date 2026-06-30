use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use anyhow::{anyhow, Context, Result};
use chrono::{Duration, Local, NaiveDate, SecondsFormat, Utc};
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
    dir: Option<PathBuf>,
}

pub struct AppLogger {
    state: Mutex<LoggerState>,
}

const LOG_RETENTION_DAYS: i64 = 30;
const LOG_FILE_PREFIX: &str = "codex-widget-";
const LOG_FILE_EXTENSION: &str = ".log";

impl AppLogger {
    pub fn new() -> Self {
        Self {
            state: Mutex::new(LoggerState {
                level: LogLevel::Off,
                dir: None,
            }),
        }
    }

    pub fn configure(&self, app: &AppHandle, level: LogLevel) -> Result<()> {
        let log_dir = app
            .path()
            .app_config_dir()
            .context("无法解析应用配置目录。")?
            .join("logs");
        prune_old_log_files_best_effort(&log_dir);

        let dir = if level == LogLevel::Off {
            None
        } else {
            Some(log_dir)
        };

        let mut state = self.state.lock().expect("日志状态锁已损坏");
        state.level = level;
        state.dir = dir;
        Ok(())
    }

    pub fn write(&self, level: LogLevel, source: &str, message: &str) -> Result<LogWriteOutcome> {
        let Some(dir) = self.active_dir(level)? else {
            return Ok(LogWriteOutcome::Filtered);
        };

        fs::create_dir_all(&dir).with_context(|| format!("无法创建日志目录：{}", dir.display()))?;

        let timestamp = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
        let source = sanitize_log_text(source);
        let message = sanitize_log_text(message);
        let line = format!("{timestamp} [{}] {source} {message}\n", level.as_label());
        let path = dated_log_path(&dir, Local::now().date_naive());

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

    fn active_dir(&self, level: LogLevel) -> Result<Option<PathBuf>> {
        let state = self.state.lock().map_err(|_| anyhow!("日志状态锁已损坏"))?;
        if !should_write(state.level, level) {
            return Ok(None);
        }
        Ok(state.dir.clone())
    }

    #[cfg(test)]
    fn configure_dir_for_test(&self, level: LogLevel, dir: Option<PathBuf>) {
        let mut state = self.state.lock().expect("日志状态锁已损坏");
        state.level = level;
        state.dir = dir;
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
    configured != LogLevel::Off
        && current != LogLevel::Off
        && current.priority() <= configured.priority()
}

fn dated_log_path(dir: &Path, date: NaiveDate) -> PathBuf {
    dir.join(dated_log_file_name(date))
}

fn dated_log_file_name(date: NaiveDate) -> String {
    format!(
        "{LOG_FILE_PREFIX}{}{LOG_FILE_EXTENSION}",
        date.format("%Y-%m-%d")
    )
}

fn prune_old_log_files_best_effort(log_dir: &Path) {
    if let Err(error) = prune_old_log_files(log_dir, Local::now().date_naive()) {
        #[cfg(debug_assertions)]
        eprintln!("清理旧日志失败：{error:#}");
        #[cfg(not(debug_assertions))]
        let _ = error;
    }
}

fn prune_old_log_files(log_dir: &Path, today: NaiveDate) -> Result<()> {
    if !log_dir.exists() {
        return Ok(());
    }

    let cutoff = today - Duration::days(LOG_RETENTION_DAYS - 1);
    for entry in
        fs::read_dir(log_dir).with_context(|| format!("无法读取日志目录：{}", log_dir.display()))?
    {
        let entry = entry.with_context(|| format!("无法读取日志目录项：{}", log_dir.display()))?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let file_name = entry.file_name();
        let file_name = file_name.to_string_lossy();
        let Some(date) = parse_dated_log_file_name(&file_name) else {
            continue;
        };
        if date < cutoff {
            fs::remove_file(&path)
                .with_context(|| format!("无法删除旧日志文件：{}", path.display()))?;
        }
    }
    Ok(())
}

fn parse_dated_log_file_name(file_name: &str) -> Option<NaiveDate> {
    let date_text = file_name
        .strip_prefix(LOG_FILE_PREFIX)?
        .strip_suffix(LOG_FILE_EXTENSION)?;
    if date_text.len() != 10 {
        return None;
    }
    NaiveDate::parse_from_str(date_text, "%Y-%m-%d").ok()
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
        let dir = temp_test_dir("off").join("logs");
        logger.configure_dir_for_test(LogLevel::Off, Some(dir.clone()));

        let outcome = logger
            .write(LogLevel::Error, "frontend.update", "获取版本失败")
            .unwrap();

        assert_eq!(outcome, LogWriteOutcome::Filtered);
        assert!(!dir.exists());
    }

    #[test]
    fn error_等级写入当天日志() {
        let logger = AppLogger::new();
        let dir = temp_test_dir("error").join("logs");
        logger.configure_dir_for_test(LogLevel::Error, Some(dir.clone()));

        let outcome = logger
            .write(LogLevel::Error, "frontend.update", "获取版本失败")
            .unwrap();

        assert_eq!(outcome, LogWriteOutcome::Written);
        let path = dated_log_path(&dir, Local::now().date_naive());
        let text = fs::read_to_string(path).unwrap();
        assert!(text.contains("[ERROR] frontend.update 获取版本失败"));
    }

    #[test]
    fn 同一天日志会追加到同一文件() {
        let logger = AppLogger::new();
        let dir = temp_test_dir("append").join("logs");
        logger.configure_dir_for_test(LogLevel::Error, Some(dir.clone()));

        logger
            .write(LogLevel::Error, "frontend.update", "第一次失败")
            .unwrap();
        logger
            .write(LogLevel::Error, "frontend.update", "第二次失败")
            .unwrap();

        let path = dated_log_path(&dir, Local::now().date_naive());
        let text = fs::read_to_string(path).unwrap();
        assert!(text.contains("第一次失败"));
        assert!(text.contains("第二次失败"));
    }

    #[test]
    fn error_等级过滤_debug() {
        let logger = AppLogger::new();
        let dir = temp_test_dir("filter-debug").join("logs");
        logger.configure_dir_for_test(LogLevel::Error, Some(dir.clone()));

        let outcome = logger
            .write(LogLevel::Debug, "backend.settings", "设置已保存")
            .unwrap();

        assert_eq!(outcome, LogWriteOutcome::Filtered);
        assert!(!dir.exists());
    }

    #[test]
    fn 清理会删除保留期外的按天日志() {
        let dir = temp_test_dir("retention").join("logs");
        fs::create_dir_all(&dir).unwrap();
        let today = NaiveDate::from_ymd_opt(2026, 6, 30).unwrap();
        let expired = dated_log_path(&dir, today - Duration::days(30));
        let recent = dated_log_path(&dir, today - Duration::days(29));
        let legacy = dir.join("codex-widget.log");
        let unrelated = dir.join("other.log");
        fs::write(&expired, "old").unwrap();
        fs::write(&recent, "recent").unwrap();
        fs::write(&legacy, "legacy").unwrap();
        fs::write(&unrelated, "other").unwrap();

        prune_old_log_files(&dir, today).unwrap();

        assert!(!expired.exists());
        assert!(recent.exists());
        assert!(legacy.exists());
        assert!(unrelated.exists());
    }

    #[test]
    fn url_认证信息脱敏() {
        let logger = AppLogger::new();
        let dir = temp_test_dir("redact").join("logs");
        logger.configure_dir_for_test(LogLevel::Error, Some(dir.clone()));

        logger
            .write(
                LogLevel::Error,
                "frontend.update",
                "代理失败：https://user:pass@example.com:443/path",
            )
            .unwrap();

        let path = dated_log_path(&dir, Local::now().date_naive());
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
