use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt;

pub(crate) fn sync_auto_start(app: &AppHandle, enabled: bool) -> Result<(), String> {
    let auto_start = app.autolaunch();
    let result = if enabled {
        auto_start.enable()
    } else {
        auto_start.disable()
    };
    result.map_err(|error| format!("无法同步开机自启设置：{error}"))?;

    let actual = read_auto_start_enabled(app)?;
    if actual != enabled {
        let expected = auto_start_state_label(enabled);
        let actual = auto_start_state_label(actual);
        return Err(format!(
            "开机自启设置未生效：期望{expected}，系统当前{actual}。"
        ));
    }

    Ok(())
}

pub(crate) fn read_auto_start_enabled(app: &AppHandle) -> Result<bool, String> {
    app.autolaunch()
        .is_enabled()
        .map_err(|error| format!("无法确认开机自启设置：{error}"))
}

fn auto_start_state_label(enabled: bool) -> &'static str {
    if enabled {
        "开启"
    } else {
        "关闭"
    }
}
