use tauri::AppHandle;

#[cfg(target_os = "macos")]
use tauri::Manager;

#[cfg(target_os = "macos")]
use crate::app_state::AppState;
#[cfg(target_os = "macos")]
use crate::logging::LogLevel;
#[cfg(target_os = "macos")]
use crate::MAIN_WINDOW_LABEL;

pub(crate) fn set_dock_icon_hidden(app: &AppHandle, hidden: bool) -> Result<(), String> {
    let visible = dock_icon_visible(hidden);

    #[cfg(target_os = "macos")]
    {
        let focused_window = app
            .get_webview_window(MAIN_WINDOW_LABEL)
            .filter(|window| window.is_focused().unwrap_or_default());

        app.set_dock_visibility(visible)
            .map_err(|error| format!("无法更新 macOS Dock 图标显示状态：{error}"))?;

        // Dock 切换可能改变应用激活状态；焦点恢复只是投影，失败不能推翻已成功的 Dock 操作。
        if let Some(window) = focused_window {
            if let Err(error) = window.set_focus() {
                app.state::<AppState>().logger.write_best_effort(
                    LogLevel::Warn,
                    "backend.dock",
                    &format!("Dock 图标切换后恢复窗口焦点失败：{error}"),
                );
            }
        }
    }

    #[cfg(not(target_os = "macos"))]
    let _ = (app, visible);

    Ok(())
}

fn dock_icon_visible(hidden: bool) -> bool {
    !hidden
}

//noinspection NonAsciiCharacters
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 隐藏设置会转换为不可见状态() {
        assert!(!dock_icon_visible(true));
        assert!(dock_icon_visible(false));
    }
}
