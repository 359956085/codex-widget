import { BALL_SIZE, PANEL_SIZE, WIDGET_MODES } from "./constants.js";
import {
  clampBallPositionToWorkArea,
  clampPositionToWorkArea,
  defaultTopRightPosition,
  isBallAtInternalWorkAreaEdge,
  positionBelongsToWorkArea,
  resolveSafeBallDock,
  workAreaForBallPosition
} from "./geometry.js";
import { createBallController } from "./window/ball-controller.js";
import { createPanelController } from "./window/panel-controller.js";
import { createPositionController } from "./window/position-controller.js";

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

  const positionController = createPositionController({
    state,
    service,
    applyNormalizedSettings,
    saveCurrentSettings,
    showError,
    logWindowError
  });

  const ballController = createBallController({
    els,
    state,
    service,
    render,
    setWidgetMode,
    positionController,
    logWindowError
  });

  const panelController = createPanelController({
    state,
    service,
    setWidgetMode,
    startBallDrag: ballController.startBallDrag,
    logWindowError
  });

  function bindEvents() {
    els.widget.addEventListener("pointerdown", panelController.startWindowDrag);
    els.widget.addEventListener("pointermove", ballController.moveBallDrag);
    els.widget.addEventListener("pointerup", ballController.finishBallDrag);
    els.widget.addEventListener("pointercancel", ballController.finishBallDrag);
    els.modeBtn.addEventListener("click", () => setWidgetMode(WIDGET_MODES.BALL));
    els.minimizeBtn.addEventListener("click", hideWindow);
    els.closeBtn.addEventListener("click", closeApp);
  }

  async function hideWindow() {
    await positionController.saveCurrentWindowPosition();
    await service.commands.hideWindow();
  }

  async function closeApp() {
    await positionController.saveCurrentWindowPosition();
    await service.commands.closeApp();
  }

  async function setWidgetMode(nextMode) {
    if (state.widgetMode === nextMode) return;

    panelController.clearPanelClick();
    await positionController.saveCurrentWindowPosition();
    ballController.clearBallClickTimer();
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
    const monitors = await service.window.availableMonitors();
    const area = targetPosition
      ? workAreaForBallPosition(targetPosition, size, monitors)
        || await workAreaForTargetPosition(targetPosition, size)
      : await workAreaForTargetPosition(targetPosition, size);
    if (!area) return;

    if (targetPosition) {
      if (isBallAtInternalWorkAreaEdge(targetPosition, size, area, monitors)) {
        state.ballDock = null;
        if (state.settings.ballDock) {
          applyNormalizedSettings({ ...state.settings, ballPosition: targetPosition, ballDock: null }, { syncDraft: !state.settingsOpen });
          await saveCurrentSettings({ silent: true });
        }
        await service.window.setPosition(targetPosition);
        render();
        return;
      }

      const dock = state.settings.ballDock
        ? resolveSafeBallDock(targetPosition, size, area, monitors)
        : null;
      const nextPosition = clampBallPositionToWorkArea(targetPosition, size, area, dock);
      state.ballDock = dock;
      if (dock !== state.settings.ballDock || !sameWindowPosition(nextPosition, targetPosition)) {
        applyNormalizedSettings({ ...state.settings, ballPosition: nextPosition, ballDock: dock }, { syncDraft: !state.settingsOpen });
        await saveCurrentSettings({ silent: true });
      }
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

  function sameWindowPosition(first, second) {
    return first?.x === second?.x && first?.y === second?.y;
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

  return {
    applyWidgetModeWindow,
    bindEvents,
    clearPanelClick: panelController.clearPanelClick,
    mergeWindowPosition: positionController.mergeWindowPosition,
    readCurrentWindowPosition: positionController.readCurrentWindowPosition,
    registerWindowMoveSave: positionController.registerWindowMoveSave,
    saveCurrentWindowPosition: positionController.saveCurrentWindowPosition
  };
}
