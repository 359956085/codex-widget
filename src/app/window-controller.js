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
import { normalizeWindowPosition } from "./settings-model.js";

const WINDOW_MODE_SETTLE_MS = 100;

export function createWindowController({
  els,
  state,
  service,
  render,
  persistSettings,
  logger
}) {
  let requestedWidgetMode = null;
  let widgetModeTransition = null;
  let windowModeGeneration = 0;
  let windowModeSettleTimer = null;

  function logWindowError(message, error) {
    logger?.error(message, error, "frontend.window");
  }

  function setWindowError(error) {
    state.errors.window = normalizeWindowError(error);
    render();
  }

  function clearWindowError() {
    if (!state.errors.window) return;
    state.errors.window = "";
    render();
  }

  const positionController = createPositionController({
    state,
    service,
    persistSettings,
    showError: setWindowError,
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
    els.widget.addEventListener("keydown", handleWidgetKeyDown);
    els.modeBtn.addEventListener("click", () => setWidgetMode(WIDGET_MODES.BALL));
    els.minimizeBtn.addEventListener("click", hideWindow);
    els.closeBtn.addEventListener("click", closeApp);
  }

  async function hideWindow() {
    try {
      await positionController.saveCurrentWindowPosition();
      await service.commands.hideWindow();
      clearWindowError();
    } catch (error) {
      logWindowError("隐藏窗口失败", error);
      setWindowError(error);
    }
  }

  async function closeApp() {
    try {
      await positionController.saveCurrentWindowPosition();
      await service.commands.closeApp();
    } catch (error) {
      logWindowError("退出应用失败", error);
      setWindowError(error);
    }
  }

  function setWidgetMode(nextMode) {
    if (nextMode !== WIDGET_MODES.BALL && nextMode !== WIDGET_MODES.PANEL) {
      return Promise.resolve();
    }

    requestedWidgetMode = nextMode;
    panelController.clearPanelClick();
    if (!widgetModeTransition) {
      // 延后一拍启动，确保同步完成的空队列也能正确清理活动 Promise。
      widgetModeTransition = Promise.resolve().then(drainWidgetModeTransitions);
    }
    return widgetModeTransition;
  }

  async function applyWidgetModeWindow({ keepPosition = false } = {}) {
    if (!service.isAvailable()) return;

    const generation = beginWindowModeApplication();
    try {
      const settings = state.settings;
      const targetPosition = keepPosition
        ? normalizeRequiredPosition(await service.window.outerPosition())
        : savedPositionForMode(state.widgetMode, settings);
      const result = await applyWindowForMode(state.widgetMode, settings, targetPosition);

      if (shouldPersistAppliedBallResult(state.widgetMode, settings, result)) {
        await persistSettings((currentSettings) => ({
          ...currentSettings,
          ballPosition: result.position,
          ballDock: result.ballDock
        }), { syncDraft: !state.settingsOpen });
      }
      clearWindowError();
      render();
    } catch (error) {
      logWindowError("切换窗口模式失败", error);
      setWindowError(error);
    } finally {
      finishWindowModeApplication(generation);
    }
  }

  async function drainWidgetModeTransitions() {
    const generation = beginWindowModeApplication();
    try {
      while (requestedWidgetMode && requestedWidgetMode !== state.widgetMode) {
        const targetMode = requestedWidgetMode;
        const succeeded = await transitionWidgetMode(targetMode);
        if (!succeeded && requestedWidgetMode === targetMode) {
          requestedWidgetMode = state.widgetMode;
        }
      }
    } finally {
      widgetModeTransition = null;
      finishWindowModeApplication(generation);
    }
  }

  async function transitionWidgetMode(targetMode) {
    const previousMode = state.widgetMode;
    const previousSettings = state.settings;
    const previousDock = state.ballDock;
    let previousPosition = null;

    ballController.clearBallClickTimer();
    positionController.clearPositionSaveTimer();
    state.ballPress = null;
    state.ballDrag = null;
    state.settingsOpen = false;

    try {
      if (service.isAvailable()) {
        previousPosition = normalizeRequiredPosition(await service.window.outerPosition());
      }
      const settingsWithPreviousPosition = mergePositionForMode(
        previousSettings,
        previousMode,
        previousPosition,
        previousDock
      );
      const targetPosition = savedPositionForMode(targetMode, settingsWithPreviousPosition);
      const result = service.isAvailable()
        ? await applyWindowForMode(targetMode, settingsWithPreviousPosition, targetPosition)
        : { mode: targetMode, position: targetPosition, ballDock: null, persistPosition: false };

      // 原生切换期间若收到更新意图，恢复旧窗口，不提交过期模式。
      if (requestedWidgetMode !== targetMode) {
        await rollbackWindowMode(previousMode, settingsWithPreviousPosition, previousPosition);
        return true;
      }

      await persistSettings((currentSettings) => buildCommittedModeSettings({
        currentSettings,
        previousMode,
        previousPosition,
        previousDock,
        targetMode,
        result
      }), { syncDraft: true });
      clearWindowError();
      render();
      return true;
    } catch (error) {
      logWindowError("切换窗口模式失败", error);
      await rollbackWindowMode(previousMode, previousSettings, previousPosition);
      setWindowError(error);
      return false;
    }
  }

  async function rollbackWindowMode(mode, settings, position) {
    if (!service.isAvailable()) return;
    try {
      await applyWindowForMode(mode, settings, position);
    } catch (rollbackError) {
      logWindowError("回滚窗口模式失败", rollbackError);
    }
  }

  async function applyWindowForMode(mode, settings, targetPosition) {
    if (mode === WIDGET_MODES.BALL) {
      return applyBallWindow(targetPosition, settings);
    }
    return applyPanelWindow(targetPosition);
  }

  async function applyBallWindow(targetPosition = null, settings = state.settings) {
    await service.window.setSize({ width: BALL_SIZE, height: BALL_SIZE });

    const size = await service.window.outerSize();
    const monitors = await service.window.availableMonitors();
    const area = targetPosition
      ? workAreaForBallPosition(targetPosition, size, monitors)
        || await workAreaForTargetPosition(targetPosition, size)
      : await workAreaForTargetPosition(targetPosition, size);
    if (!area) throw new Error("无法获取悬浮球所在工作区。");

    if (targetPosition) {
      if (isBallAtInternalWorkAreaEdge(targetPosition, size, area, monitors)) {
        await service.window.setPosition(targetPosition);
        return {
          mode: WIDGET_MODES.BALL,
          position: targetPosition,
          ballDock: null,
          persistPosition: true
        };
      }

      const dock = settings.ballDock
        ? resolveSafeBallDock(targetPosition, size, area, monitors)
        : null;
      const nextPosition = clampBallPositionToWorkArea(targetPosition, size, area, dock);
      await service.window.setPosition(nextPosition);
      return {
        mode: WIDGET_MODES.BALL,
        position: nextPosition,
        ballDock: dock,
        persistPosition: true
      };
    }

    const nextPosition = defaultTopRightPosition(size, area);
    await service.window.setPosition(nextPosition);
    return {
      mode: WIDGET_MODES.BALL,
      position: nextPosition,
      ballDock: null,
      persistPosition: false
    };
  }

  async function applyPanelWindow(targetPosition = null) {
    await service.window.setSize(PANEL_SIZE);

    const size = await service.window.outerSize();
    const area = await workAreaForTargetPosition(targetPosition, size);
    if (!area) throw new Error("无法获取面板所在工作区。");

    const nextPosition = targetPosition
      ? clampPositionToWorkArea(targetPosition, size, area)
      : defaultTopRightPosition(size, area);
    await service.window.setPosition(nextPosition);
    return {
      mode: WIDGET_MODES.PANEL,
      position: nextPosition,
      ballDock: null,
      persistPosition: Boolean(targetPosition)
    };
  }

  function handleWidgetKeyDown(event) {
    if (state.widgetMode !== WIDGET_MODES.BALL || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    return setWidgetMode(WIDGET_MODES.PANEL);
  }

  function savedPositionForMode(mode, settings) {
    return mode === WIDGET_MODES.BALL ? settings.ballPosition : settings.panelPosition;
  }

  function sameWindowPosition(first, second) {
    return first?.x === second?.x && first?.y === second?.y;
  }

  function shouldPersistAppliedBallResult(mode, settings, result) {
    return mode === WIDGET_MODES.BALL
      && result.persistPosition
      && (result.ballDock !== settings.ballDock || !sameWindowPosition(result.position, settings.ballPosition));
  }

  function mergePositionForMode(settings, mode, position, ballDock) {
    if (!position) return { ...settings };
    if (mode === WIDGET_MODES.BALL) {
      return { ...settings, ballPosition: position, ballDock };
    }
    return { ...settings, panelPosition: position };
  }

  function buildCommittedModeSettings({
    currentSettings,
    previousMode,
    previousPosition,
    previousDock,
    targetMode,
    result
  }) {
    const nextSettings = mergePositionForMode(currentSettings, previousMode, previousPosition, previousDock);
    nextSettings.widgetMode = targetMode;
    if (targetMode === WIDGET_MODES.BALL) {
      nextSettings.ballDock = result.ballDock;
      if (result.persistPosition) {
        nextSettings.ballPosition = result.position;
      }
    }
    return nextSettings;
  }

  function beginWindowModeApplication() {
    windowModeGeneration += 1;
    if (windowModeSettleTimer) {
      window.clearTimeout(windowModeSettleTimer);
      windowModeSettleTimer = null;
    }
    state.isApplyingWindowMode = true;
    return windowModeGeneration;
  }

  function finishWindowModeApplication(generation) {
    if (generation !== windowModeGeneration) return;
    if (windowModeSettleTimer) window.clearTimeout(windowModeSettleTimer);
    windowModeSettleTimer = window.setTimeout(() => {
      if (generation !== windowModeGeneration) return;
      windowModeSettleTimer = null;
      state.isApplyingWindowMode = false;
    }, WINDOW_MODE_SETTLE_MS);
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
    saveCurrentWindowPosition: positionController.saveCurrentWindowPosition,
    setWidgetMode
  };
}

function normalizeRequiredPosition(position) {
  const normalized = normalizeWindowPosition(position);
  if (!normalized) throw new Error("读取到无效窗口位置。");
  return normalized;
}

function normalizeWindowError(error) {
  if (typeof error === "string") return error;
  if (error?.message) return error.message;
  try {
    return JSON.stringify(error) || "未知窗口错误";
  } catch {
    return String(error ?? "未知窗口错误");
  }
}
