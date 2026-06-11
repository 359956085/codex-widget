use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const SETTINGS_FILE_NAME: &str = "settings.json";
const DEFAULT_REFRESH_INTERVAL_MINUTES: u16 = 5;
const MIN_REFRESH_INTERVAL_MINUTES: u16 = 1;
const MAX_REFRESH_INTERVAL_MINUTES: u16 = 1440;
const DEFAULT_AUTO_UPDATE_ENABLED: bool = true;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Locale {
    Zh,
    En,
}

impl Default for Locale {
    fn default() -> Self {
        Self::Zh
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum WidgetMode {
    Panel,
    Ball,
}

impl Default for WidgetMode {
    fn default() -> Self {
        Self::Panel
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default)]
    pub codex_cli_path: Option<String>,
    #[serde(default)]
    pub update_proxy: Option<String>,
    #[serde(default = "default_refresh_interval_minutes")]
    pub refresh_interval_minutes: u16,
    #[serde(default)]
    pub locale: Locale,
    #[serde(default = "default_auto_update_enabled")]
    pub auto_update_enabled: bool,
    #[serde(default)]
    pub widget_mode: WidgetMode,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            codex_cli_path: None,
            update_proxy: None,
            refresh_interval_minutes: DEFAULT_REFRESH_INTERVAL_MINUTES,
            locale: Locale::default(),
            auto_update_enabled: DEFAULT_AUTO_UPDATE_ENABLED,
            widget_mode: WidgetMode::default(),
        }
    }
}

pub struct SettingsService;

impl SettingsService {
    pub fn load(app: &AppHandle) -> Result<AppSettings> {
        let path = settings_path(app)?;
        load_from_path(&path)
    }

    pub fn save(app: &AppHandle, settings: AppSettings) -> Result<AppSettings> {
        let path = settings_path(app)?;
        save_to_path(&path, settings)
    }
}

fn settings_path(app: &AppHandle) -> Result<PathBuf> {
    Ok(app
        .path()
        .app_config_dir()
        .context("无法解析应用配置目录。")?
        .join(SETTINGS_FILE_NAME))
}

fn load_from_path(path: &Path) -> Result<AppSettings> {
    if !path.exists() {
        return Ok(AppSettings::default());
    }

    let text = fs::read_to_string(path)
        .with_context(|| format!("无法读取设置文件：{}", path.display()))?;
    let settings = serde_json::from_str::<AppSettings>(&text).unwrap_or_default();
    Ok(normalize_loaded_settings(settings))
}

fn save_to_path(path: &Path, settings: AppSettings) -> Result<AppSettings> {
    let settings = validate_and_normalize(settings)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("无法创建设置目录：{}", parent.display()))?;
    }

    let text = serde_json::to_string_pretty(&settings).context("设置序列化失败。")?;
    fs::write(path, format!("{text}\n"))
        .with_context(|| format!("无法写入设置文件：{}", path.display()))?;
    Ok(settings)
}

fn validate_and_normalize(mut settings: AppSettings) -> Result<AppSettings> {
    settings.codex_cli_path = normalize_optional_text(settings.codex_cli_path);
    settings.update_proxy = normalize_optional_text(settings.update_proxy);

    if let Some(path) = &settings.codex_cli_path {
        validate_codex_cli_path(Path::new(path))?;
    }

    if let Some(proxy) = &settings.update_proxy {
        validate_proxy(proxy)?;
    }

    if !is_valid_refresh_interval(settings.refresh_interval_minutes) {
        return Err(anyhow!(
            "自动刷新时间必须在 {MIN_REFRESH_INTERVAL_MINUTES}-{MAX_REFRESH_INTERVAL_MINUTES} 分钟之间。"
        ));
    }

    Ok(settings)
}

fn normalize_loaded_settings(mut settings: AppSettings) -> AppSettings {
    settings.codex_cli_path = normalize_optional_text(settings.codex_cli_path);
    settings.update_proxy = normalize_optional_text(settings.update_proxy);
    if !is_valid_refresh_interval(settings.refresh_interval_minutes) {
        settings.refresh_interval_minutes = DEFAULT_REFRESH_INTERVAL_MINUTES;
    }
    settings
}

fn default_refresh_interval_minutes() -> u16 {
    DEFAULT_REFRESH_INTERVAL_MINUTES
}

fn default_auto_update_enabled() -> bool {
    DEFAULT_AUTO_UPDATE_ENABLED
}

fn is_valid_refresh_interval(value: u16) -> bool {
    (MIN_REFRESH_INTERVAL_MINUTES..=MAX_REFRESH_INTERVAL_MINUTES).contains(&value)
}

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    value.and_then(|text| {
        let text = text.trim().to_string();
        if text.is_empty() {
            None
        } else {
            Some(text)
        }
    })
}

fn validate_codex_cli_path(path: &Path) -> Result<()> {
    if !path.is_file() {
        return Err(anyhow!(
            "Codex CLI 路径不存在或不是文件：{}",
            path.display()
        ));
    }

    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if !file_name.eq_ignore_ascii_case("codex.exe") {
        return Err(anyhow!("Codex CLI 文件名必须为 codex.exe。"));
    }

    Ok(())
}

fn validate_proxy(proxy: &str) -> Result<()> {
    let lower = proxy.to_ascii_lowercase();
    let supported = lower.starts_with("http://")
        || lower.starts_with("https://")
        || lower.starts_with("socks5://");
    if !supported || proxy.chars().any(char::is_whitespace) {
        return Err(anyhow!(
            "自动更新代理必须以 http://、https:// 或 socks5:// 开头，且不能包含空白字符。"
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn 缺失设置文件返回默认值() {
        let dir = temp_test_dir("missing");
        let settings = load_from_path(&dir.join("settings.json")).unwrap();

        assert_eq!(settings, AppSettings::default());
    }

    #[test]
    fn 无效_json_回退默认值() {
        let dir = temp_test_dir("invalid-json");
        let path = dir.join("settings.json");
        fs::create_dir_all(&dir).unwrap();
        fs::write(&path, "{").unwrap();

        let settings = load_from_path(&path).unwrap();

        assert_eq!(settings, AppSettings::default());
    }

    #[test]
    fn 保存读取设置往返() {
        let dir = temp_test_dir("roundtrip");
        let path = dir.join("settings.json");
        let codex = create_fake_codex(&dir);
        let settings = AppSettings {
            codex_cli_path: Some(format!("  {}  ", codex.display())),
            update_proxy: Some("  http://127.0.0.1:7890  ".to_string()),
            refresh_interval_minutes: 15,
            locale: Locale::En,
            auto_update_enabled: false,
            widget_mode: WidgetMode::Ball,
        };

        let saved = save_to_path(&path, settings).unwrap();
        let loaded = load_from_path(&path).unwrap();

        assert_eq!(saved, loaded);
        assert_eq!(loaded.codex_cli_path, Some(codex.display().to_string()));
        assert_eq!(
            loaded.update_proxy,
            Some("http://127.0.0.1:7890".to_string())
        );
        assert!(!loaded.auto_update_enabled);
        assert_eq!(loaded.widget_mode, WidgetMode::Ball);
    }

    #[test]
    fn 旧配置缺失新增字段时使用默认值() {
        let dir = temp_test_dir("old-config-auto-update");
        let path = dir.join("settings.json");
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            &path,
            r#"{
  "codexCliPath": null,
  "updateProxy": null,
  "refreshIntervalMinutes": 5,
  "locale": "zh"
}"#,
        )
        .unwrap();

        let settings = load_from_path(&path).unwrap();

        assert!(settings.auto_update_enabled);
        assert_eq!(settings.widget_mode, WidgetMode::Panel);
    }

    #[test]
    fn codex_路径必须存在且文件名正确() {
        let dir = temp_test_dir("codex-path");
        let codex = create_fake_codex(&dir);
        let other = dir.join("other.exe");
        fs::write(&other, "").unwrap();

        assert!(validate_codex_cli_path(&codex).is_ok());
        assert!(validate_codex_cli_path(&other).is_err());
        assert!(validate_codex_cli_path(&dir.join("missing").join("codex.exe")).is_err());
    }

    #[test]
    fn 代理只允许受支持协议() {
        assert!(validate_proxy("http://127.0.0.1:7890").is_ok());
        assert!(validate_proxy("https://proxy.local:7890").is_ok());
        assert!(validate_proxy("socks5://127.0.0.1:7890").is_ok());
        assert!(validate_proxy("ftp://127.0.0.1:21").is_err());
        assert!(validate_proxy("http://127.0.0.1: 7890").is_err());
    }

    #[test]
    fn 刷新间隔必须在边界内() {
        let dir = temp_test_dir("refresh-interval");
        let path = dir.join("settings.json");
        let mut settings = AppSettings::default();

        settings.refresh_interval_minutes = 0;
        assert!(save_to_path(&path, settings.clone()).is_err());

        settings.refresh_interval_minutes = 1441;
        assert!(save_to_path(&path, settings.clone()).is_err());

        settings.refresh_interval_minutes = 1440;
        assert!(save_to_path(&path, settings).is_ok());
    }

    fn create_fake_codex(dir: &Path) -> PathBuf {
        fs::create_dir_all(dir).unwrap();
        let codex = dir.join("codex.exe");
        fs::write(&codex, "").unwrap();
        codex
    }

    fn temp_test_dir(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("codex-widget-settings-{name}-{unique}"))
    }
}
