use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tempfile::NamedTempFile;

use crate::logging::LogLevel;

const SETTINGS_FILE_NAME: &str = "settings.json";
const DEFAULT_REFRESH_INTERVAL_MINUTES: u16 = 5;
const MIN_REFRESH_INTERVAL_MINUTES: u16 = 1;
const MAX_REFRESH_INTERVAL_MINUTES: u16 = 1440;
const DEFAULT_AUTO_UPDATE_ENABLED: bool = true;
const DEFAULT_AUTO_START_ENABLED: bool = false;

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Locale {
    #[default]
    Zh,
    En,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ThemeMode {
    #[default]
    Default,
    Basic1,
    Basic2,
    Basic3,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum MeterWindow {
    Primary,
    #[default]
    Secondary,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum WidgetMode {
    #[default]
    Panel,
    Ball,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum BallDock {
    Left,
    Right,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WindowPosition {
    pub x: i32,
    pub y: i32,
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
    #[serde(default)]
    pub theme: ThemeMode,
    #[serde(default)]
    pub meter_window: MeterWindow,
    #[serde(default)]
    pub meter_window_migrated: bool,
    #[serde(default = "default_auto_update_enabled")]
    pub auto_update_enabled: bool,
    #[serde(default = "default_auto_start_enabled")]
    pub auto_start_enabled: bool,
    #[serde(default)]
    pub onboarding_seen: bool,
    #[serde(default)]
    pub log_level: LogLevel,
    #[serde(default)]
    pub widget_mode: WidgetMode,
    #[serde(default)]
    pub panel_position: Option<WindowPosition>,
    #[serde(default)]
    pub ball_position: Option<WindowPosition>,
    #[serde(default)]
    pub ball_dock: Option<BallDock>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            codex_cli_path: None,
            update_proxy: None,
            refresh_interval_minutes: DEFAULT_REFRESH_INTERVAL_MINUTES,
            locale: Locale::default(),
            theme: ThemeMode::default(),
            meter_window: MeterWindow::default(),
            meter_window_migrated: true,
            auto_update_enabled: DEFAULT_AUTO_UPDATE_ENABLED,
            auto_start_enabled: DEFAULT_AUTO_START_ENABLED,
            onboarding_seen: false,
            log_level: LogLevel::default(),
            widget_mode: WidgetMode::default(),
            panel_position: None,
            ball_position: None,
            ball_dock: None,
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

    pub fn normalize(settings: AppSettings) -> Result<AppSettings> {
        validate_and_normalize(settings)
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
    let settings = serde_json::from_str::<AppSettings>(&text)
        .with_context(|| format!("设置文件格式无效：{}", path.display()))?;
    let should_persist_migration = !settings.meter_window_migrated;
    let settings = normalize_loaded_settings(settings);
    if should_persist_migration {
        write_settings_file(path, &settings)?;
    }
    Ok(settings)
}

fn save_to_path(path: &Path, settings: AppSettings) -> Result<AppSettings> {
    let settings = validate_and_normalize(settings)?;
    write_settings_file(path, &settings)?;
    Ok(settings)
}

fn write_settings_file(path: &Path, settings: &AppSettings) -> Result<()> {
    write_settings_file_with_hook(path, settings, || Ok(()))
}

fn write_settings_file_with_hook<F>(
    path: &Path,
    settings: &AppSettings,
    before_persist: F,
) -> Result<()>
where
    F: FnOnce() -> Result<()>,
{
    let parent = path
        .parent()
        .ok_or_else(|| anyhow!("设置文件缺少父目录：{}", path.display()))?;
    fs::create_dir_all(parent)
        .with_context(|| format!("无法创建设置目录：{}", parent.display()))?;

    let text = serde_json::to_string_pretty(settings).context("设置序列化失败。")?;
    let mut temp_file = NamedTempFile::new_in(parent)
        .with_context(|| format!("无法在设置目录创建临时文件：{}", parent.display()))?;
    temp_file
        .write_all(format!("{text}\n").as_bytes())
        .with_context(|| format!("无法写入设置临时文件：{}", path.display()))?;
    temp_file
        .as_file_mut()
        .sync_all()
        .with_context(|| format!("无法同步设置临时文件：{}", path.display()))?;
    // 故障注入点同时保证测试能验证：替换前失败时，旧文件仍完整可读。
    before_persist()?;
    temp_file
        .persist(path)
        .map_err(|error| anyhow!("无法原子替换设置文件：{}，{}", path.display(), error.error))?;
    Ok(())
}

fn validate_and_normalize(mut settings: AppSettings) -> Result<AppSettings> {
    settings.codex_cli_path = normalize_optional_text(settings.codex_cli_path);
    settings.update_proxy = normalize_optional_text(settings.update_proxy);
    // 正常保存只标记迁移已处理，不能覆盖用户之后手动选择的 5 小时窗口。
    settings.meter_window_migrated = true;

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
    if !settings.meter_window_migrated {
        if settings.meter_window == MeterWindow::Primary {
            settings.meter_window = MeterWindow::Secondary;
        }
        settings.meter_window_migrated = true;
    }
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

fn default_auto_start_enabled() -> bool {
    DEFAULT_AUTO_START_ENABLED
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
    if !is_valid_codex_file_name(file_name) {
        return Err(anyhow!(
            "Codex CLI 文件名必须为 {}。",
            expected_codex_file_name()
        ));
    }

    validate_codex_cli_executable(path)
}

#[cfg(windows)]
fn expected_codex_file_name() -> &'static str {
    "codex.exe"
}

#[cfg(not(windows))]
fn expected_codex_file_name() -> &'static str {
    "codex"
}

#[cfg(windows)]
fn is_valid_codex_file_name(file_name: &str) -> bool {
    file_name.eq_ignore_ascii_case(expected_codex_file_name())
}

#[cfg(not(windows))]
fn is_valid_codex_file_name(file_name: &str) -> bool {
    file_name == expected_codex_file_name()
}

#[cfg(windows)]
fn validate_codex_cli_executable(_path: &Path) -> Result<()> {
    Ok(())
}

#[cfg(unix)]
fn validate_codex_cli_executable(path: &Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;

    let mode = path
        .metadata()
        .with_context(|| format!("无法读取 Codex CLI 文件权限：{}", path.display()))?
        .permissions()
        .mode();
    if mode & 0o111 == 0 {
        return Err(anyhow!("Codex CLI 文件缺少可执行权限：{}", path.display()));
    }
    Ok(())
}

#[cfg(all(not(windows), not(unix)))]
fn validate_codex_cli_executable(_path: &Path) -> Result<()> {
    Ok(())
}

fn validate_proxy(proxy: &str) -> Result<()> {
    if proxy.chars().any(char::is_whitespace) {
        return Err(anyhow!(
            "自动更新代理必须以 http://、https:// 或 socks5:// 开头，且不能包含空白字符。"
        ));
    }

    let url = reqwest::Url::parse(proxy).context("自动更新代理不是有效 URL。")?;
    if !matches!(url.scheme(), "http" | "https" | "socks5") || url.host_str().is_none() {
        return Err(anyhow!(
            "自动更新代理必须使用 http、https 或 socks5 协议，并包含有效主机。"
        ));
    }
    reqwest::Proxy::all(proxy).context("自动更新代理配置无效。")?;
    Ok(())
}

//noinspection NonAsciiCharacters
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
    fn 无效_json_返回明确错误() {
        let dir = temp_test_dir("invalid-json");
        let path = dir.join("settings.json");
        fs::create_dir_all(&dir).unwrap();
        fs::write(&path, "{").unwrap();

        let error = load_from_path(&path).unwrap_err().to_string();

        assert!(error.contains("设置文件格式无效"));
        assert!(error.contains("settings.json"));
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
            theme: ThemeMode::Basic3,
            meter_window: MeterWindow::Secondary,
            meter_window_migrated: false,
            auto_update_enabled: false,
            auto_start_enabled: true,
            onboarding_seen: true,
            log_level: LogLevel::Debug,
            widget_mode: WidgetMode::Ball,
            panel_position: Some(WindowPosition { x: 120, y: 80 }),
            ball_position: Some(WindowPosition { x: 1800, y: 240 }),
            ball_dock: Some(BallDock::Right),
        };

        let saved = save_to_path(&path, settings).unwrap();
        let loaded = load_from_path(&path).unwrap();

        assert_eq!(saved, loaded);
        assert_eq!(loaded.codex_cli_path, Some(codex.display().to_string()));
        assert_eq!(
            loaded.update_proxy,
            Some("http://127.0.0.1:7890".to_string())
        );
        assert_eq!(loaded.theme, ThemeMode::Basic3);
        assert_eq!(loaded.meter_window, MeterWindow::Secondary);
        assert!(loaded.meter_window_migrated);
        assert_eq!(loaded.log_level, LogLevel::Debug);
        assert!(!loaded.auto_update_enabled);
        assert!(loaded.auto_start_enabled);
        assert!(loaded.onboarding_seen);
        assert_eq!(loaded.widget_mode, WidgetMode::Ball);
        assert_eq!(
            loaded.panel_position,
            Some(WindowPosition { x: 120, y: 80 })
        );
        assert_eq!(
            loaded.ball_position,
            Some(WindowPosition { x: 1800, y: 240 })
        );
        assert_eq!(loaded.ball_dock, Some(BallDock::Right));
    }

    #[test]
    fn 原子替换前失败不会破坏旧设置() {
        let dir = temp_test_dir("atomic-write-failure");
        let path = dir.join("settings.json");
        let original = AppSettings {
            theme: ThemeMode::Basic1,
            ..AppSettings::default()
        };
        save_to_path(&path, original.clone()).unwrap();
        let original_text = fs::read_to_string(&path).unwrap();
        let replacement = AppSettings {
            theme: ThemeMode::Basic3,
            ..AppSettings::default()
        };

        let result =
            write_settings_file_with_hook(&path, &replacement, || Err(anyhow!("模拟替换失败")));

        assert!(result.is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), original_text);
        assert_eq!(load_from_path(&path).unwrap(), original);
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
        assert!(!settings.auto_start_enabled);
        assert!(!settings.onboarding_seen);
        assert_eq!(settings.theme, ThemeMode::Default);
        assert_eq!(settings.meter_window, MeterWindow::Secondary);
        assert!(settings.meter_window_migrated);
        assert_eq!(settings.log_level, LogLevel::Off);
        assert_eq!(settings.widget_mode, WidgetMode::Panel);
        assert_eq!(settings.panel_position, None);
        assert_eq!(settings.ball_position, None);
        assert_eq!(settings.ball_dock, None);
    }

    #[test]
    fn 旧五小时配置首次读取会迁移并写回() {
        let dir = temp_test_dir("migrate-meter-window");
        let path = dir.join("settings.json");
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            &path,
            r#"{
  "meterWindow": "primary"
}"#,
        )
        .unwrap();

        let migrated = load_from_path(&path).unwrap();
        let persisted = fs::read_to_string(&path).unwrap();
        let persisted = serde_json::from_str::<serde_json::Value>(&persisted).unwrap();

        assert_eq!(migrated.meter_window, MeterWindow::Secondary);
        assert!(migrated.meter_window_migrated);
        assert_eq!(persisted["meterWindow"], "secondary");
        assert_eq!(persisted["meterWindowMigrated"], true);
    }

    #[test]
    fn 迁移后手动选择五小时不会再次纠正() {
        let dir = temp_test_dir("manual-primary-after-migration");
        let path = dir.join("settings.json");
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            &path,
            r#"{
  "meterWindow": "primary"
}"#,
        )
        .unwrap();

        let mut settings = load_from_path(&path).unwrap();
        settings.meter_window = MeterWindow::Primary;
        let saved = save_to_path(&path, settings).unwrap();
        let loaded = load_from_path(&path).unwrap();

        assert_eq!(saved.meter_window, MeterWindow::Primary);
        assert!(saved.meter_window_migrated);
        assert_eq!(loaded.meter_window, MeterWindow::Primary);
        assert!(loaded.meter_window_migrated);
    }

    #[test]
    fn codex_路径必须存在且文件名正确() {
        let dir = temp_test_dir("codex-path");
        let codex = create_fake_codex(&dir);
        let other = dir.join("other");
        fs::write(&other, "").unwrap();

        assert!(validate_codex_cli_path(&codex).is_ok());
        assert!(validate_codex_cli_path(&other).is_err());
        assert!(
            validate_codex_cli_path(&dir.join("missing").join(expected_codex_file_name())).is_err()
        );
    }

    #[test]
    fn 代理只允许受支持协议() {
        assert!(validate_proxy("http://127.0.0.1:7890").is_ok());
        assert!(validate_proxy("https://proxy.local:7890").is_ok());
        assert!(validate_proxy("socks5://127.0.0.1:7890").is_ok());
        assert!(validate_proxy("http://user:pass@[::1]:7890").is_ok());
        assert!(validate_proxy("ftp://127.0.0.1:21").is_err());
        assert!(validate_proxy("http://").is_err());
        assert!(validate_proxy("http://127.0.0.1: 7890").is_err());
    }

    #[test]
    fn 刷新间隔必须在边界内() {
        let dir = temp_test_dir("refresh-interval");
        let path = dir.join("settings.json");
        let mut settings = AppSettings {
            refresh_interval_minutes: 0,
            ..AppSettings::default()
        };
        assert!(save_to_path(&path, settings.clone()).is_err());

        settings.refresh_interval_minutes = 1441;
        assert!(save_to_path(&path, settings.clone()).is_err());

        settings.refresh_interval_minutes = 1440;
        assert!(save_to_path(&path, settings).is_ok());
    }

    fn create_fake_codex(dir: &Path) -> PathBuf {
        fs::create_dir_all(dir).unwrap();
        let codex = dir.join(expected_codex_file_name());
        fs::write(&codex, "").unwrap();
        make_executable_for_test(&codex);
        codex
    }

    #[cfg(unix)]
    fn make_executable_for_test(path: &Path) {
        use std::os::unix::fs::PermissionsExt;

        let mut permissions = fs::metadata(path).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(path, permissions).unwrap();
    }

    #[cfg(not(unix))]
    fn make_executable_for_test(_path: &Path) {}

    fn temp_test_dir(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("codex-widget-settings-{name}-{unique}"))
    }
}
