mod quota;
mod settings;

use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};

use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, Position, Size, State,
    WebviewWindow,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tokio::sync::Mutex;

use quota::{QuotaService, QuotaSnapshot};
use settings::{AppSettings, BallDock, SettingsService, WidgetMode, WindowPosition};

const MAIN_WINDOW_LABEL: &str = "main";
const TRAY_ID: &str = "main-tray";
const PANEL_WIDTH: f64 = 390.0;
const PANEL_HEIGHT: f64 = 236.0;
const BALL_SIZE: f64 = 88.0;
const SNAP_DISTANCE: i32 = 24;

pub struct AppState {
    quota_service: Mutex<QuotaService>,
    always_on_top: AtomicBool,
}

impl AppState {
    fn new() -> Self {
        Self {
            quota_service: Mutex::new(QuotaService::new()),
            always_on_top: AtomicBool::new(true),
        }
    }
}

#[tauri::command]
async fn get_quota(app: AppHandle, state: State<'_, AppState>) -> Result<QuotaSnapshot, String> {
    let settings = SettingsService::load(&app).map_err(|error| error.to_string())?;
    let codex_cli_path = settings.codex_cli_path.as_deref().map(std::path::Path::new);
    // 长连接会话必须串行使用，避免多个刷新同时读写同一条 stdio 通道。
    let mut service = state.quota_service.lock().await;
    service
        .get_quota(codex_cli_path)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn hide_window(window: WebviewWindow) -> Result<(), String> {
    window.hide().map_err(|error| error.to_string())
}

#[tauri::command]
fn close_app(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn get_always_on_top(state: State<'_, AppState>) -> bool {
    state.always_on_top.load(Ordering::SeqCst)
}

#[tauri::command]
fn set_always_on_top(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
    value: bool,
) -> Result<bool, String> {
    window
        .set_always_on_top(value)
        .map_err(|error| error.to_string())?;
    state.always_on_top.store(value, Ordering::SeqCst);
    rebuild_tray_menu(&app, value).map_err(|error| error.to_string())?;
    app.emit("window:always-on-top-changed", value)
        .map_err(|error| error.to_string())?;
    Ok(value)
}

#[tauri::command]
fn open_codex(app: AppHandle) -> Result<(), String> {
    let settings = SettingsService::load(&app).map_err(|error| error.to_string())?;
    let codex_cli_path = settings.codex_cli_path.as_deref().map(std::path::Path::new);
    let command = quota::resolve_codex_command(codex_cli_path);
    Command::new(&command)
        .spawn()
        .map_err(|error| format!("无法打开 Codex CLI：{}，{}", command.display(), error))?;
    Ok(())
}

#[tauri::command]
fn get_settings(app: AppHandle) -> Result<AppSettings, String> {
    SettingsService::load(&app).map_err(|error| error.to_string())
}

#[tauri::command]
async fn save_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    settings: AppSettings,
) -> Result<AppSettings, String> {
    let previous = SettingsService::load(&app).unwrap_or_default();
    let settings = SettingsService::normalize(settings).map_err(|error| error.to_string())?;
    if previous.auto_start_enabled != settings.auto_start_enabled {
        sync_auto_start(&app, settings.auto_start_enabled)?;
    }
    let saved = SettingsService::save(&app, settings).map_err(|error| error.to_string())?;
    if previous.codex_cli_path != saved.codex_cli_path {
        let mut service = state.quota_service.lock().await;
        service.reset_session().await;
    }
    Ok(saved)
}

fn sync_auto_start(app: &AppHandle, enabled: bool) -> Result<(), String> {
    let auto_start = app.autolaunch();
    if enabled {
        auto_start.enable()
    } else {
        auto_start.disable()
    }
    .map_err(|error| format!("无法同步开机自启设置：{error}"))?;

    let actual = auto_start
        .is_enabled()
        .map_err(|error| format!("无法确认开机自启设置：{error}"))?;
    if actual != enabled {
        let expected = if enabled { "开启" } else { "关闭" };
        let actual = if actual { "开启" } else { "关闭" };
        return Err(format!(
            "开机自启设置未生效：期望{expected}，系统当前{actual}。"
        ));
    }

    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .manage(AppState::new())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let window = app
                .get_webview_window(MAIN_WINDOW_LABEL)
                .expect("主窗口不存在");
            // Windows 的无边框原生阴影会附带 1px 白边，圆角加大后会在透明角落露出虚框。
            window.set_shadow(false)?;
            window.set_icon(load_app_icon()?)?;
            let settings = SettingsService::load(app.handle()).unwrap_or_default();
            apply_startup_window_state(&window, &settings)?;
            window.show()?;
            create_tray(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_quota,
            hide_window,
            close_app,
            get_always_on_top,
            set_always_on_top,
            open_codex,
            get_settings,
            save_settings
        ])
        .run(tauri::generate_context!())
        .expect("运行 Tauri 应用失败");
}

fn apply_startup_window_state(window: &WebviewWindow, settings: &AppSettings) -> tauri::Result<()> {
    window.set_size(Size::Logical(window_size_for_mode(settings.widget_mode)))?;
    if restore_saved_window_position(window, settings)? {
        return Ok(());
    }
    place_window_top_right(window)
}

fn window_size_for_mode(mode: WidgetMode) -> LogicalSize<f64> {
    match mode {
        WidgetMode::Panel => LogicalSize {
            width: PANEL_WIDTH,
            height: PANEL_HEIGHT,
        },
        WidgetMode::Ball => LogicalSize {
            width: BALL_SIZE,
            height: BALL_SIZE,
        },
    }
}

fn restore_saved_window_position(
    window: &WebviewWindow,
    settings: &AppSettings,
) -> tauri::Result<bool> {
    let Some(position) = saved_position_for_mode(settings) else {
        return Ok(false);
    };

    let size = window.outer_size()?;
    let window_width = size.width as i32;
    let window_height = size.height as i32;
    let monitors = window.available_monitors()?;
    for monitor in monitors {
        let work_area = monitor.work_area();
        let left = work_area.position.x;
        let top = work_area.position.y;
        let right = left + work_area.size.width as i32;
        let bottom = top + work_area.size.height as i32;
        if !position_belongs_to_area(
            position,
            window_width,
            window_height,
            left,
            top,
            right,
            bottom,
        ) {
            continue;
        }
        set_position_in_work_area(
            window,
            position,
            window_width,
            window_height,
            left,
            top,
            right,
            bottom,
            startup_ball_dock(settings),
        )?;
        return Ok(true);
    }

    if let Some(monitor) = window.primary_monitor()? {
        let work_area = monitor.work_area();
        let left = work_area.position.x;
        let top = work_area.position.y;
        let right = left + work_area.size.width as i32;
        let bottom = top + work_area.size.height as i32;
        set_position_in_work_area(
            window,
            position,
            window_width,
            window_height,
            left,
            top,
            right,
            bottom,
            startup_ball_dock(settings),
        )?;
        return Ok(true);
    }

    Ok(false)
}

fn saved_position_for_mode(settings: &AppSettings) -> Option<WindowPosition> {
    match settings.widget_mode {
        WidgetMode::Panel => settings.panel_position,
        WidgetMode::Ball => settings.ball_position,
    }
}

fn startup_ball_dock(settings: &AppSettings) -> Option<BallDock> {
    if settings.widget_mode == WidgetMode::Ball {
        settings.ball_dock
    } else {
        None
    }
}

fn position_belongs_to_area(
    position: WindowPosition,
    window_width: i32,
    window_height: i32,
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
) -> bool {
    let center_x = position.x + window_width / 2;
    let center_y = position.y + window_height / 2;
    center_x >= left && center_x <= right && center_y >= top && center_y <= bottom
}

#[allow(clippy::too_many_arguments)]
fn set_position_in_work_area(
    window: &WebviewWindow,
    position: WindowPosition,
    window_width: i32,
    window_height: i32,
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
    ball_dock: Option<BallDock>,
) -> tauri::Result<()> {
    let mut x = position
        .x
        .clamp(left, left.max(right.saturating_sub(window_width)));
    let y = position
        .y
        .clamp(top, top.max(bottom.saturating_sub(window_height)));

    if let Some(dock) = ball_dock {
        x = match dock {
            BallDock::Left => left - window_width / 2,
            BallDock::Right => right - window_width / 2,
        };
    }

    window.set_position(Position::Physical(PhysicalPosition { x, y }))
}

fn place_window_top_right(window: &WebviewWindow) -> tauri::Result<()> {
    if let Some(monitor) = window.primary_monitor()? {
        let work_area = monitor.work_area();
        let size = window.outer_size()?;
        let x =
            work_area.position.x + work_area.size.width as i32 - size.width as i32 - SNAP_DISTANCE;
        let y = work_area.position.y + SNAP_DISTANCE;
        window.set_position(Position::Physical(PhysicalPosition { x, y }))?;
    }
    Ok(())
}

fn create_tray(app: &AppHandle) -> tauri::Result<()> {
    let menu = build_tray_menu(app, true)?;
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(load_app_icon()?)
        .tooltip("Codex CLI 额度小组件")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "toggle-window" => {
                let _ = toggle_window(app);
            }
            "refresh-quota" => {
                let _ = app.emit("quota:refresh-requested", ());
            }
            "toggle-always-on-top" => {
                let _ = toggle_always_on_top_from_tray(app);
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let _ = toggle_window(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

fn build_tray_menu(app: &AppHandle, always_on_top: bool) -> tauri::Result<Menu<tauri::Wry>> {
    let toggle = MenuItem::with_id(app, "toggle-window", "显示/隐藏", true, None::<&str>)?;
    let refresh = MenuItem::with_id(app, "refresh-quota", "刷新额度", true, None::<&str>)?;
    let pin_label = if always_on_top {
        "取消置顶"
    } else {
        "置顶"
    };
    let pin = MenuItem::with_id(app, "toggle-always-on-top", pin_label, true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    Menu::with_items(app, &[&toggle, &refresh, &pin, &separator, &quit])
}

fn rebuild_tray_menu(app: &AppHandle, always_on_top: bool) -> tauri::Result<()> {
    let menu = build_tray_menu(app, always_on_top)?;
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        tray.set_menu(Some(menu))?;
    }
    Ok(())
}

fn toggle_window(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        if window.is_visible()? {
            window.hide()?;
        } else {
            window.show()?;
            window.set_focus()?;
        }
    }
    Ok(())
}

fn toggle_always_on_top_from_tray(app: &AppHandle) -> tauri::Result<()> {
    let state = app.state::<AppState>();
    let next = !state.always_on_top.load(Ordering::SeqCst);
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        window.set_always_on_top(next)?;
    }
    state.always_on_top.store(next, Ordering::SeqCst);
    rebuild_tray_menu(app, next)?;
    app.emit("window:always-on-top-changed", next)?;
    Ok(())
}

fn load_app_icon() -> tauri::Result<Image<'static>> {
    // 托盘和开发期窗口图标复用同一份资源，避免打包图标与运行时图标不一致。
    Ok(Image::from_bytes(include_bytes!("../icons/icon.png"))?.to_owned())
}
