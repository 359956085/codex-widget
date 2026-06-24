import {
  BALL_SIZE,
  CLICK_DELAY_MS,
  PANEL_DOUBLE_CLICK_DISTANCE,
  PANEL_DOUBLE_CLICK_MS,
  PANEL_SIZE,
  POSITION_SAVE_DEBOUNCE_MS,
  WIDGET_MODES
} from "./constants.js";
import {
  clamp,
  clampBallPositionToWorkArea,
  clampPositionToWorkArea,
  defaultTopRightPosition,
  positionBelongsToWorkArea,
  resolveBallDock,
  workAreaBounds
} from "./geometry.js";
import { normalizeBallDock, normalizeWindowPosition } from "./settings-model.js";

export function createWindowController({
  els,
  state,
  service,
  render,
  applyNormalizedSettings,
  saveCurrentSettings,
  showError,
  logger
}) {
  function logWindowError(message, error) {
    logger?.error(message, error, "frontend.window");
  }

  function bindEvents() {
    els.widget.addEventListener("pointerdown", startWindowDrag);
    els.widget.addEventListener("pointermove", moveBallDrag);
    els.widget.addEventListener("pointerup", finishBallDrag);
    els.widget.addEventListener("pointercancel", finishBallDrag);
    els.modeBtn.addEventListener("click", () => setWidgetMode(WIDGET_MODES.BALL));
    els.minimizeBtn.addEventListener("click", hideWindow);
    els.closeBtn.addEventListener("click", closeApp);
  }

  async function startWindowDrag(event) {
    const noDragTarget =
      event.target instanceof Element
        ? event.target.closest("button, a, input, textarea, select, [data-no-drag]")
        : null;

    if (event.button !== 0 || noDragTarget) {
      clearPanelClick();
      return;
    }

    if (state.widgetMode === WIDGET_MODES.BALL) {
      clearPanelClick();
      await startBallDrag(event);
      return;
    }

    if (isPanelDoubleClick(event)) {
      clearPanelClick();
      event.preventDefault();
      await setWidgetMode(WIDGET_MODES.BALL);
      return;
    }

    rememberPanelClick(event);
    event.preventDefault();

    if (!service.isAvailable()) return;

    try {
      await service.window.startDragging();
    } catch (error) {
      logWindowError("启动窗口拖动失败", error);
    }
  }

  function rememberPanelClick(event) {
    state.panelClick = {
      at: Date.now(),
      screenX: event.screenX,
      screenY: event.screenY
    };
  }

  function isPanelDoubleClick(event) {
    const previous = state.panelClick;
    if (!previous) return false;

    const elapsed = Date.now() - previous.at;
    const distance = Math.hypot(event.screenX - previous.screenX, event.screenY - previous.screenY);
    return elapsed <= PANEL_DOUBLE_CLICK_MS && distance <= PANEL_DOUBLE_CLICK_DISTANCE;
  }

  function clearPanelClick() {
    state.panelClick = null;
  }

  async function startBallDrag(event) {
    event.preventDefault();
    state.ballPress = {
      pointerId: event.pointerId,
      startScreenX: event.screenX,
      startScreenY: event.screenY,
      currentScreenX: event.screenX,
      currentScreenY: event.screenY,
      moved: false
    };

    if (!service.isAvailable()) return;

    try {
      els.widget.setPointerCapture?.(event.pointerId);
      const [position, scaleFactor] = await Promise.all([service.window.outerPosition(), service.window.scaleFactor()]);
      const press = state.ballPress;
      if (!press || press.pointerId !== event.pointerId) return;

      const startPointerX = press.startScreenX * scaleFactor;
      const startPointerY = press.startScreenY * scaleFactor;
      state.ballDrag = {
        pointerId: event.pointerId,
        startPointerX,
        startPointerY,
        startX: position.x,
        startY: position.y,
        scaleFactor,
        moved: press.moved,
        frame: null,
        nextX: Math.round(position.x + press.currentScreenX * scaleFactor - startPointerX),
        nextY: Math.round(position.y + press.currentScreenY * scaleFactor - startPointerY)
      };
      render();
    } catch (error) {
      logWindowError("启动悬浮球拖动失败", error);
      state.ballDrag = null;
    }
  }

  function moveBallDrag(event) {
    const press = state.ballPress;
    if (!press || event.pointerId !== press.pointerId) return;

    press.currentScreenX = event.screenX;
    press.currentScreenY = event.screenY;
    if (!press.moved && Math.hypot(event.screenX - press.startScreenX, event.screenY - press.startScreenY) > 4) {
      markBallPressMoved(press);
    }

    const drag = state.ballDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;

    const nextX = drag.startX + event.screenX * drag.scaleFactor - drag.startPointerX;
    const nextY = drag.startY + event.screenY * drag.scaleFactor - drag.startPointerY;
    drag.nextX = Math.round(nextX);
    drag.nextY = Math.round(nextY);

    if (press.moved) {
      drag.moved = true;
    } else if (!drag.moved && Math.hypot(drag.nextX - drag.startX, drag.nextY - drag.startY) > 4) {
      drag.moved = true;
      markBallPressMoved(press);
    }

    if (drag.frame !== null) return;
    drag.frame = window.requestAnimationFrame(() => {
      drag.frame = null;
      if (!state.ballDrag) return;
      service.window
        .setPosition({ x: drag.nextX, y: drag.nextY })
        .catch((error) => logWindowError("移动悬浮球失败", error));
    });
  }

  async function finishBallDrag(event) {
    const press = state.ballPress;
    const drag = state.ballDrag;
    if (!press || event.pointerId !== press.pointerId) return;

    state.ballPress = null;
    state.ballDrag = null;
    try {
      els.widget.releasePointerCapture?.(event.pointerId);
    } catch {
      // 指针捕获可能已由系统释放，这里只需要保证拖动状态被清理。
    }

    if (event.type === "pointercancel") return;

    const moved = press.moved || Boolean(drag?.moved);
    if (!moved) {
      await handleBallPressClick();
      return;
    }

    await snapBallAfterDrag(drag ? { x: drag.nextX, y: drag.nextY } : null);
  }

  function markBallPressMoved(press) {
    press.moved = true;
    clearBallClickTimer();
    state.ballDock = null;
    render();
  }

  async function handleBallPressClick() {
    if (state.widgetMode !== WIDGET_MODES.BALL) return;

    if (state.ballClickTimer) {
      clearBallClickTimer();
      await restorePanelFromBall();
      return;
    }

    state.ballClickTimer = window.setTimeout(() => {
      state.ballClickTimer = null;
      if (state.widgetMode === WIDGET_MODES.BALL && state.ballDock) {
        expandBallFromDock();
      }
    }, CLICK_DELAY_MS);
  }

  async function restorePanelFromBall() {
    if (state.widgetMode !== WIDGET_MODES.BALL) return;
    clearBallClickTimer();
    await setWidgetMode(WIDGET_MODES.PANEL);
  }

  function clearBallClickTimer() {
    if (!state.ballClickTimer) return;
    window.clearTimeout(state.ballClickTimer);
    state.ballClickTimer = null;
  }

  async function registerWindowMoveSave() {
    if (!service.isAvailable() || state.windowMoveUnlisten) return;

    try {
      state.windowMoveUnlisten = await service.window.onMoved(() => {
        if (state.isApplyingWindowMode || state.ballDrag) return;
        scheduleSaveCurrentWindowPosition();
      });
    } catch (error) {
      logWindowError("监听窗口移动失败", error);
    }
  }

  function scheduleSaveCurrentWindowPosition() {
    if (!service.isAvailable() || state.isApplyingWindowMode) return;
    if (state.positionSaveTimer) {
      window.clearTimeout(state.positionSaveTimer);
    }
    state.positionSaveTimer = window.setTimeout(() => {
      state.positionSaveTimer = null;
      saveCurrentWindowPosition();
    }, POSITION_SAVE_DEBOUNCE_MS);
  }

  function clearPositionSaveTimer() {
    if (!state.positionSaveTimer) return;
    window.clearTimeout(state.positionSaveTimer);
    state.positionSaveTimer = null;
  }

  async function saveCurrentWindowPosition({ silent = true } = {}) {
    clearPositionSaveTimer();
    if (!service.isAvailable() || state.isApplyingWindowMode) return;

    try {
      const position = await readCurrentWindowPosition();
      if (!position) return;
      await persistWindowPosition(position, state.widgetMode, state.ballDock, { silent });
    } catch (error) {
      if (silent) {
        logWindowError("保存窗口位置失败", error);
      } else {
        logWindowError("保存窗口位置失败", error);
        showError(error);
      }
    }
  }

  async function persistWindowPosition(position, mode, dock = null, { silent = true } = {}) {
    const nextSettings = { ...state.settings, widgetMode: state.widgetMode };
    if (mode === WIDGET_MODES.BALL) {
      nextSettings.ballPosition = position;
      nextSettings.ballDock = normalizeBallDock(dock);
    } else {
      nextSettings.panelPosition = position;
    }
    applyNormalizedSettings(nextSettings, { syncDraft: !state.settingsOpen });
    await saveCurrentSettings({ silent });
  }

  async function readCurrentWindowPosition() {
    clearPositionSaveTimer();
    if (!service.isAvailable() || state.isApplyingWindowMode) return null;

    try {
      return normalizeWindowPosition(await service.window.outerPosition());
    } catch (error) {
      logWindowError("读取窗口位置失败", error);
      return null;
    }
  }

  function mergeWindowPosition(settings, position) {
    if (!position) return settings;

    const nextSettings = { ...settings, widgetMode: state.widgetMode };
    if (state.widgetMode === WIDGET_MODES.BALL) {
      nextSettings.ballPosition = position;
      nextSettings.ballDock = normalizeBallDock(state.ballDock);
    } else {
      nextSettings.panelPosition = position;
    }
    return nextSettings;
  }

  async function hideWindow() {
    await saveCurrentWindowPosition();
    await service.commands.hideWindow();
  }

  async function closeApp() {
    await saveCurrentWindowPosition();
    await service.commands.closeApp();
  }

  async function setWidgetMode(nextMode) {
    if (state.widgetMode === nextMode) return;

    clearPanelClick();
    await saveCurrentWindowPosition();
    clearBallClickTimer();
    state.ballPress = null;
    state.ballDrag = null;
    state.settingsOpen = false;
    applyNormalizedSettings({ ...state.settings, widgetMode: nextMode });
    render();

    await applyWidgetModeWindow();
    await saveCurrentSettings();
  }

  async function applyWidgetModeWindow({ keepPosition = false } = {}) {
    if (!service.isAvailable()) return;

    state.isApplyingWindowMode = true;
    try {
      const targetPosition = keepPosition ? await service.window.outerPosition() : savedPositionForCurrentMode();

      if (state.widgetMode === WIDGET_MODES.BALL) {
        await applyBallWindow(targetPosition);
      } else {
        await applyPanelWindow(targetPosition);
      }
    } catch (error) {
      logWindowError("切换窗口模式失败", error);
    } finally {
      window.setTimeout(() => {
        state.isApplyingWindowMode = false;
      }, 100);
    }
  }

  async function applyBallWindow(targetPosition = null) {
    await service.window.setSize({ width: BALL_SIZE, height: BALL_SIZE });

    const size = await service.window.outerSize();
    const area = await workAreaForTargetPosition(targetPosition, size);
    if (!area) return;

    if (targetPosition) {
      const nextPosition = clampBallPositionToWorkArea(targetPosition, size, area, state.settings.ballDock);
      state.ballDock = state.settings.ballDock;
      await service.window.setPosition(nextPosition);
      render();
      return;
    }

    state.ballDock = null;
    applyNormalizedSettings({ ...state.settings, ballDock: null });
    const nextPosition = defaultTopRightPosition(size, area);
    await service.window.setPosition(nextPosition);
    render();
  }

  async function applyPanelWindow(targetPosition = null) {
    await service.window.setSize(PANEL_SIZE);

    const size = await service.window.outerSize();
    const area = await workAreaForTargetPosition(targetPosition, size);
    if (!area) return;

    const nextPosition = targetPosition
      ? clampPositionToWorkArea(targetPosition, size, area)
      : defaultTopRightPosition(size, area);
    await service.window.setPosition(nextPosition);
  }

  function savedPositionForCurrentMode() {
    return state.widgetMode === WIDGET_MODES.BALL ? state.settings.ballPosition : state.settings.panelPosition;
  }

  async function workAreaForTargetPosition(position, size) {
    if (position) {
      const monitors = await service.window.availableMonitors();
      const matched = monitors.find((monitor) => positionBelongsToWorkArea(position, size, monitor.workArea));
      if (matched) return matched.workArea;
    }

    const monitor = await service.window.currentMonitor();
    return monitor?.workArea || null;
  }

  async function snapBallAfterDrag(targetPosition = null) {
    if (!service.isAvailable()) return;

    try {
      const [monitor, position, size] = await Promise.all([
        service.window.currentMonitor(),
        service.window.outerPosition(),
        service.window.outerSize()
      ]);
      const area = monitor?.workArea;
      if (!area) return;

      const bounds = workAreaBounds(area);
      const dragPosition = targetPosition || position;
      const dock = resolveBallDock(dragPosition, size, bounds);
      const nextPosition = clampBallPositionToWorkArea(dragPosition, size, area, dock);
      state.ballDock = dock;
      await service.window.setPosition(nextPosition);
      await persistWindowPosition(nextPosition, WIDGET_MODES.BALL, dock);
      render();
    } catch (error) {
      logWindowError("悬浮球吸附失败", error);
    }
  }

  async function expandBallFromDock() {
    if (!service.isAvailable() || !state.ballDock) return;

    try {
      const [monitor, position, size] = await Promise.all([
        service.window.currentMonitor(),
        service.window.outerPosition(),
        service.window.outerSize()
      ]);
      const area = monitor?.workArea;
      if (!area) return;

      const bounds = workAreaBounds(area);
      const x = state.ballDock === "left" ? bounds.left : bounds.right - size.width;
      const y = clamp(position.y, bounds.top, Math.max(bounds.top, bounds.bottom - size.height));
      const nextPosition = { x: Math.round(x), y: Math.round(y) };
      state.ballDock = null;
      await service.window.setPosition(nextPosition);
      await persistWindowPosition(nextPosition, WIDGET_MODES.BALL, null);
      render();
    } catch (error) {
      logWindowError("展开悬浮球失败", error);
    }
  }

  return {
    applyWidgetModeWindow,
    bindEvents,
    clearPanelClick,
    mergeWindowPosition,
    readCurrentWindowPosition,
    registerWindowMoveSave,
    saveCurrentWindowPosition
  };
}
