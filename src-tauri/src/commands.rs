use std::path::Path;
use std::process::Command;
use std::sync::atomic::Ordering;

use tauri::{AppHandle, Emitter, State, WebviewWindow};

use crate::app_state::AppState;
use crate::autostart::{read_auto_start_enabled, sync_auto_start};
use crate::logging::{AppLogger, LogLevel};
use crate::quota::{self, QuotaSnapshot, ResetCreditExpiries};
use crate::settings::{AppSettings, SettingsService};
use crate::tray::rebuild_tray_menu;

#[tauri::command]
pub(crate) async fn get_quota(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<QuotaSnapshot, String> {
    let settings = {
        let _settings_guard = state.settings_lock.lock().await;
        load_operational_settings(&app, &state, "backend.quota")
    };
    let codex_cli_path = settings.codex_cli_path.as_deref().map(Path::new);
    // 长连接会话必须串行使用，避免多个刷新同时读写同一条 stdio 通道。
    let mut service = state.quota_service.lock().await;
    service.get_quota(codex_cli_path).await.map_err(|error| {
        let message = error.to_string();
        state
            .logger
            .write_best_effort(LogLevel::Error, "backend.quota", &message);
        message
    })
}

#[tauri::command]
pub(crate) async fn get_reset_credit_expiries(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ResetCreditExpiries, String> {
    let settings = {
        let _settings_guard = state.settings_lock.lock().await;
        load_operational_settings(&app, &state, "backend.quota.resetCredits")
    };
    quota::fetch_reset_credit_expiries(settings.update_proxy.as_deref())
        .await
        .map_err(|error| {
            let message = error.to_string();
            state
                .logger
                .write_best_effort(LogLevel::Error, "backend.quota.resetCredits", &message);
            message
        })
}

#[tauri::command]
pub(crate) fn hide_window(window: WebviewWindow) -> Result<(), String> {
    window.hide().map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn close_app(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
pub(crate) fn get_always_on_top(state: State<'_, AppState>) -> bool {
    state.always_on_top.load(Ordering::SeqCst)
}

#[tauri::command]
pub(crate) fn set_always_on_top(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
    value: bool,
) -> Result<bool, String> {
    window.set_always_on_top(value).map_err(|error| {
        let message = error.to_string();
        state
            .logger
            .write_best_effort(LogLevel::Error, "backend.window", &message);
        message
    })?;
    state.always_on_top.store(value, Ordering::SeqCst);
    rebuild_tray_menu(&app, value).map_err(|error| error.to_string())?;
    app.emit("window:always-on-top-changed", value)
        .map_err(|error| error.to_string())?;
    Ok(value)
}

#[tauri::command]
pub(crate) async fn open_codex(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let settings = {
        let _settings_guard = state.settings_lock.lock().await;
        load_operational_settings(&app, &state, "backend.codex")
    };
    let codex_cli_path = settings.codex_cli_path.as_deref().map(Path::new);
    let command = quota::resolve_codex_command(codex_cli_path);
    Command::new(&command).spawn().map_err(|error| {
        let message = format!("无法打开 Codex CLI：{}，{}", command.display(), error);
        state
            .logger
            .write_best_effort(LogLevel::Error, "backend.codex", &message);
        message
    })?;
    Ok(())
}

#[tauri::command]
pub(crate) async fn get_settings(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<AppSettings, String> {
    let _settings_guard = state.settings_lock.lock().await;
    SettingsService::load(&app).map_err(|error| {
        let message = error.to_string();
        state
            .logger
            .write_best_effort(LogLevel::Error, "backend.settings", &message);
        message
    })
}

#[tauri::command]
pub(crate) async fn save_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    settings: AppSettings,
) -> Result<AppSettings, String> {
    let settings_guard = state.settings_lock.lock().await;
    let (previous, previous_loaded) = match SettingsService::load(&app) {
        Ok(settings) => (settings, true),
        Err(error) => {
            state.logger.write_best_effort(
                LogLevel::Warn,
                "backend.settings",
                &format!("旧设置无法读取，将使用默认值恢复：{error}"),
            );
            (AppSettings::default(), false)
        }
    };
    let settings = SettingsService::normalize(settings).map_err(|error| {
        let message = error.to_string();
        state
            .logger
            .write_best_effort(LogLevel::Error, "backend.settings", &message);
        message
    })?;
    let log_dir = AppLogger::resolve_log_dir(&app).map_err(|error| error.to_string())?;
    let should_check_auto_start =
        !previous_loaded || previous.auto_start_enabled != settings.auto_start_enabled;
    let original_auto_start = if should_check_auto_start {
        read_auto_start_enabled(&app).inspect_err(|error| {
            state
                .logger
                .write_best_effort(LogLevel::Error, "backend.settings", error);
        })?
    } else {
        settings.auto_start_enabled
    };
    let codex_cli_path_changed = previous.codex_cli_path != settings.codex_cli_path;
    let target_auto_start = settings.auto_start_enabled;
    let saved = persist_with_auto_start(
        original_auto_start,
        target_auto_start,
        |enabled| sync_auto_start(&app, enabled),
        || SettingsService::save(&app, settings).map_err(|error| error.to_string()),
    )
    .inspect_err(|error| {
        state
            .logger
            .write_best_effort(LogLevel::Error, "backend.settings", error);
    })?;
    state.logger.configure_resolved(log_dir, saved.log_level);
    state
        .logger
        .write_best_effort(LogLevel::Debug, "backend.settings", "设置已保存");
    drop(settings_guard);
    if codex_cli_path_changed {
        let mut service = state.quota_service.lock().await;
        service.reset_session().await;
    }
    Ok(saved)
}

#[tauri::command]
pub(crate) fn write_frontend_log(
    state: State<'_, AppState>,
    level: LogLevel,
    message: String,
    context: Option<String>,
) -> Result<(), String> {
    let source = context
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("frontend");
    state
        .logger
        .write(level, source, &message)
        .map(|_| ())
        .map_err(|error| error.to_string())
}

fn load_operational_settings(app: &AppHandle, state: &AppState, source: &str) -> AppSettings {
    SettingsService::load(app).unwrap_or_else(|error| {
        state.logger.write_best_effort(
            LogLevel::Error,
            source,
            &format!("设置读取失败，当前操作使用默认设置：{error}"),
        );
        AppSettings::default()
    })
}

fn persist_with_auto_start<T, Sync, Persist>(
    original: bool,
    target: bool,
    mut sync: Sync,
    persist: Persist,
) -> Result<T, String>
where
    Sync: FnMut(bool) -> Result<(), String>,
    Persist: FnOnce() -> Result<T, String>,
{
    let changed = original != target;
    if changed {
        if let Err(error) = sync(target) {
            return Err(append_rollback_error(error, sync(original)));
        }
    }

    match persist() {
        Ok(value) => Ok(value),
        Err(error) if changed => Err(append_rollback_error(error, sync(original))),
        Err(error) => Err(error),
    }
}

fn append_rollback_error(error: String, rollback: Result<(), String>) -> String {
    match rollback {
        Ok(()) => error,
        Err(rollback_error) => format!("{error}；恢复原开机自启状态失败：{rollback_error}"),
    }
}

//noinspection NonAsciiCharacters
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 设置写入失败会恢复原开机自启状态() {
        let mut calls = Vec::new();

        let result = persist_with_auto_start(
            false,
            true,
            |enabled| {
                calls.push(enabled);
                Ok(())
            },
            || Err::<(), _>("设置写入失败".to_string()),
        );

        assert_eq!(calls, vec![true, false]);
        assert_eq!(result.unwrap_err(), "设置写入失败");
    }

    #[test]
    fn 自启切换失败也会尝试恢复() {
        let mut calls = Vec::new();

        let result = persist_with_auto_start(
            false,
            true,
            |enabled| {
                calls.push(enabled);
                if enabled {
                    Err("切换失败".to_string())
                } else {
                    Ok(())
                }
            },
            || Ok(()),
        );

        assert_eq!(calls, vec![true, false]);
        assert_eq!(result.unwrap_err(), "切换失败");
    }

    #[test]
    fn 自启恢复失败会合并错误() {
        let mut calls = 0;

        let result = persist_with_auto_start(
            false,
            true,
            |_| {
                calls += 1;
                if calls == 1 {
                    Ok(())
                } else {
                    Err("恢复失败".to_string())
                }
            },
            || Err::<(), _>("设置写入失败".to_string()),
        );

        assert_eq!(
            result.unwrap_err(),
            "设置写入失败；恢复原开机自启状态失败：恢复失败"
        );
    }

    #[test]
    fn 自启状态未变化时不调用系统接口() {
        let mut calls = 0;

        let result = persist_with_auto_start(
            true,
            true,
            |_| {
                calls += 1;
                Ok(())
            },
            || Ok("saved"),
        );

        assert_eq!(calls, 0);
        assert_eq!(result.unwrap(), "saved");
    }
}
