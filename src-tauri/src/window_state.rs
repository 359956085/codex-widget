use tauri::{LogicalSize, PhysicalPosition, Position, Size, WebviewWindow};

use crate::settings::{AppSettings, BallDock, WidgetMode, WindowPosition};

const PANEL_WIDTH: f64 = 390.0;
const PANEL_HEIGHT: f64 = 236.0;
const BALL_SIZE: f64 = 88.0;
const SNAP_DISTANCE: i32 = 24;

pub(crate) fn apply_startup_window_state(
    window: &WebviewWindow,
    settings: &AppSettings,
) -> tauri::Result<()> {
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
