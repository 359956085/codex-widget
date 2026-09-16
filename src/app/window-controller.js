import { normalizeError } from "./errors.js";
import { createLifecycle } from "./lifecycle.js";
import {
  BALL_SIZE,
  PANEL_DOCK_COLLAPSED_SIZE,
  PANEL_DOCK_EXPANDED_SIZE,
  PANEL_DOCK_LEAVE_DEBOUNCE_MS,
  PANEL_DOUBLE_CLICK_DISTANCE,
  PANEL_DOUBLE_CLICK_MS,
  PANEL_SIZE,
  SNAP_DISTANCE,
  WIDGET_MODES
} from "./constants.js";
import {
  clamp,
  clampBallPositionToWorkArea,
  clampPanelDockPositionToWorkArea,
  clampPositionToWorkArea,
  defaultTopRightPosition,
  isBallAtInternalWorkAreaEdge,
  positionBelongsToWorkArea,
  resolveSafeBallDock,
  resolveSafePanelDock,
  workAreaForBallPosition
} from "./geometry.js";
import { createBallController } from "./window/ball-controller.js";
import { createPanelController } from "./window/panel-controller.js";
import { createPositionController } from "./window/position-controller.js";
import { normalizePanelDock, normalizeWindowPosition } from "./settings-model.js";

const WINDOW_MODE_SETTLE_MS = 100;

export function createWindowController({
  els,
  state,
  service,
  render,
  persistSettings,
  logger
}) {
  const lifecycle = createLifecycle();
  render = lifecycle.guard(render);
  let requestedWidgetMode = null;
  let widgetModeTransition = null;
  let windowModeGeneration = 0;
  let windowModeSettleTimer = null;

  function logWindowError(message, error) {
    logger?.error(message, error, "frontend.window");
  }

  function setWindowError(error) {
    state.errors.window = normalizeError(error, "未知窗口错误");
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
    logWindowError,
    onPanelMove: onPanelMoveCheckDock
  });

  const ballController = createBallController({
    els,
    state,
    service,
    lifecycle,
    render,
    persistSettings,
    setWidgetMode,
    logWindowError,
    setWindowError,
    positionController
  });

  const panelController = createPanelController({
    els,
    state,
    service,
    lifecycle,
    setWidgetMode,
    startBallDrag: ballController.startBallDrag,
    logWindowError
  });

  function bindEvents() {
    if (!lifecycle.bind()) return;
    lifecycle.listen(els.widget, "pointerdown", panelController.startWindowDrag);
    lifecycle.listen(els.widget, "pointermove", ballController.moveBallDrag);
    lifecycle.listen(els.widget, "pointerup", ballController.finishBallDrag);
    lifecycle.listen(els.widget, "pointercancel", ballController.finishBallDrag);
    lifecycle.listen(els.widget, "keydown", handleWidgetKeyDown);
    lifecycle.listen(els.modeBtn, "click", () => setWidgetMode(WIDGET_MODES.BALL));
    lifecycle.listen(els.minimizeBtn, "click", hideWindow);
    lifecycle.listen(els.closeBtn, "click", closeApp);

    if (els.panelDock) {
      lifecycle.listen(els.panelDock, "pointerenter", handlePanelDockPointerEnter);
      lifecycle.listen(els.panelDock, "pointerleave", handlePanelDockPointerLeave);
      lifecycle.listen(els.panelDock, "pointerdown", handlePanelDockPointerDown);
    }
  }

  async function onPanelMoveCheckDock(position) {
    if (!service.isAvailable() || state.panelDock) return false;
    try {
      const [monitors, currentMonitor] = await Promise.all([
        service.window.availableMonitors(),
        service.window.currentMonitor()
      ]);
      const area = currentMonitor?.workArea;
      const dock = resolveSafePanelDock(position, PANEL_SIZE, area, monitors);
      if (!dock) return false;

      await applyPanelDock(dock, position, area);
      return true;
    } catch (error) {
      logWindowError("检查面板吸附失败", error);
      return false;
    }
  }

  async function applyPanelDock(dock, position, area) {
    state.panelDock = dock;
    state.panelDockExpanded = false;
    clearPanelDockClick();
    if (state.panelDockLeaveTimer) {
      window.clearTimeout(state.panelDockLeaveTimer);
      state.panelDockLeaveTimer = null;
    }
    render();

    const dockedPos = clampPanelDockPositionToWorkArea(position, PANEL_DOCK_COLLAPSED_SIZE, area, dock);
    await service.window.setSize(PANEL_DOCK_COLLAPSED_SIZE);
    await service.window.setPosition(dockedPos);
    await positionController.persistWindowPosition(dockedPos, state.widgetMode, state.ballDock, dock);
  }

  async function handlePanelDockPointerEnter() {
    if (!state.panelDock || state.panelDockExpanded || lifecycle.destroyed) return;
    if (state.panelDockLeaveTimer) {
      window.clearTimeout(state.panelDockLeaveTimer);
      state.panelDockLeaveTimer = null;
    }
    state.panelDockExpanded = true;
    if (service.isAvailable()) {
      try {
        if (state.panelDock === "right") {
          const currentPos = await service.window.outerPosition();
          const widthDiff = PANEL_DOCK_EXPANDED_SIZE.width - PANEL_DOCK_COLLAPSED_SIZE.width;
          await service.window.setPosition({ x: currentPos.x - widthDiff, y: currentPos.y });
        }
        await service.window.setSize(PANEL_DOCK_EXPANDED_SIZE);
      } catch (error) {
        logWindowError("展开吸附面板失败", error);
      }
    }
    render();
  }

  function handlePanelDockPointerLeave() {
    if (!state.panelDock || !state.panelDockExpanded || lifecycle.destroyed) return;
    if (state.panelDockLeaveTimer) {
      window.clearTimeout(state.panelDockLeaveTimer);
    }
    state.panelDockLeaveTimer = window.setTimeout(async () => {
      state.panelDockLeaveTimer = null;
      if (!state.panelDock || !state.panelDockExpanded || lifecycle.destroyed) return;
      state.panelDockExpanded = false;
      if (service.isAvailable()) {
        try {
          if (state.panelDock === "right") {
            const currentPos = await service.window.outerPosition();
            const widthDiff = PANEL_DOCK_EXPANDED_SIZE.width - PANEL_DOCK_COLLAPSED_SIZE.width;
            await service.window.setSize(PANEL_DOCK_COLLAPSED_SIZE);
            await service.window.setPosition({ x: currentPos.x + widthDiff, y: currentPos.y });
          } else {
            await service.window.setSize(PANEL_DOCK_COLLAPSED_SIZE);
          }
        } catch (error) {
          logWindowError("收起吸附面板失败", error);
        }
      }
      render();
    }, PANEL_DOCK_LEAVE_DEBOUNCE_MS);
  }

  function handlePanelDockPointerDown(event) {
    if (event.button !== 0 || !state.panelDock) return;

    if (isPanelDockDoubleClick(event)) {
      clearPanelDockClick();
      event.preventDefault();
      restoreFromPanelDock();
      return;
    }
    rememberPanelDockClick(event);

    const startScreenX = event.screenX;
    const dock = state.panelDock;
    let detached = false;

    if (typeof els.panelDock?.setPointerCapture === "function") {
      try {
        els.panelDock.setPointerCapture(event.pointerId);
      } catch (error) {
        logWindowError("设置吸附指针捕获失败", error);
      }
    }

    async function onPointerMove(moveEvent) {
      if (detached) return;
      const dx = moveEvent.screenX - startScreenX;
      if ((dock === "left" && dx > 16) || (dock === "right" && dx < -16)) {
        detached = true;
        cleanup();
        await restoreFromPanelDock(moveEvent);
      }
    }

    const targets = [els.panelDock];
    if (typeof window !== "undefined" && typeof window.addEventListener === "function" && window !== els.panelDock) {
      targets.push(window);
    }

    function cleanup() {
      if (typeof els.panelDock?.releasePointerCapture === "function") {
        try {
          els.panelDock.releasePointerCapture(event.pointerId);
        } catch (error) {
          logWindowError("释放吸附指针捕获失败", error);
        }
      }
      targets.forEach((target) => {
        target?.removeEventListener?.("pointermove", onPointerMove);
        target?.removeEventListener?.("pointerup", cleanup);
        target?.removeEventListener?.("pointercancel", cleanup);
      });
    }

    targets.forEach((target) => {
      target?.addEventListener?.("pointermove", onPointerMove);
      target?.addEventListener?.("pointerup", cleanup);
      target?.addEventListener?.("pointercancel", cleanup);
    });
  }

  function rememberPanelDockClick(event) {
    state.panelDockClick = {
      at: Date.now(),
      screenX: event.screenX,
      screenY: event.screenY
    };
  }

  function isPanelDockDoubleClick(event) {
    const previous = state.panelDockClick;
    if (!previous) return false;

    const elapsed = Date.now() - previous.at;
    const distance = Math.hypot(event.screenX - previous.screenX, event.screenY - previous.screenY);
    return elapsed <= PANEL_DOUBLE_CLICK_MS && distance <= PANEL_DOUBLE_CLICK_DISTANCE;
  }

  function clearPanelDockClick() {
    state.panelDockClick = null;
  }

  async function restoreFromPanelDock(moveEvent = null) {
    if (!state.panelDock) return;
    const previousDock = state.panelDock;
    state.panelDock = null;
    state.panelDockExpanded = false;
    clearPanelDockClick();
    if (state.panelDockLeaveTimer) {
      window.clearTimeout(state.panelDockLeaveTimer);
      state.panelDockLeaveTimer = null;
    }

    if (service.isAvailable()) {
      try {
        const currentMonitor = await service.window.currentMonitor();
        const area = currentMonitor?.workArea;
        const currentPos = await service.window.outerPosition();
        const safeDetachMargin = SNAP_DISTANCE + 24;

        let restoredPos;
        if (moveEvent && area) {
          const targetX = previousDock === "left"
            ? Math.max(
                area.position.x + safeDetachMargin,
                Math.min(moveEvent.screenX - 80, area.position.x + area.size.width - PANEL_SIZE.width - safeDetachMargin)
              )
            : Math.min(
                area.position.x + area.size.width - PANEL_SIZE.width - safeDetachMargin,
                Math.max(moveEvent.screenX - (PANEL_SIZE.width - 80), area.position.x + safeDetachMargin)
              );
          const targetY = clamp(
            moveEvent.screenY - 20,
            area.position.y,
            area.position.y + area.size.height - PANEL_SIZE.height
          );
          restoredPos = clampPositionToWorkArea(
            { x: Math.round(targetX), y: Math.round(targetY) },
            PANEL_SIZE,
            area
          );
        } else {
          const targetX = previousDock === "left"
            ? Math.round(area ? area.position.x + safeDetachMargin : currentPos.x + 48)
            : Math.round(area ? area.position.x + area.size.width - PANEL_SIZE.width - safeDetachMargin : currentPos.x - (PANEL_SIZE.width - PANEL_DOCK_COLLAPSED_SIZE.width));
          restoredPos = area
            ? clampPositionToWorkArea({ x: targetX, y: currentPos.y }, PANEL_SIZE, area)
            : { x: targetX, y: currentPos.y };
        }

        await service.window.setSize(PANEL_SIZE);
        await service.window.setPosition(restoredPos);
        await positionController.persistWindowPosition(restoredPos, state.widgetMode, state.ballDock, null);
        render();

        if (moveEvent) {
          try {
            await service.window.startDragging();
          } catch (dragError) {
            logWindowError("脱离吸附后启动原生拖拽失败", dragError);
          }
        }
      } catch (error) {
        logWindowError("还原面板失败", error);
      }
    }
    render();
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
    if (lifecycle.destroyed) return Promise.resolve();
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
    if (lifecycle.destroyed || !service.isAvailable()) return;

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
    if (lifecycle.destroyed) {
      widgetModeTransition = null;
      return;
    }
    const generation = beginWindowModeApplication();
    try {
      while (!lifecycle.destroyed && requestedWidgetMode && requestedWidgetMode !== state.widgetMode) {
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
    state.panelDock = null;
    state.panelDockExpanded = false;
    if (state.panelDockLeaveTimer) {
      window.clearTimeout(state.panelDockLeaveTimer);
      state.panelDockLeaveTimer = null;
    }

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
    return applyPanelWindow(targetPosition, settings);
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

  async function applyPanelWindow(targetPosition = null, settings = state.settings) {
    if (settings.panelDock) {
      state.panelDock = settings.panelDock;
      state.panelDockExpanded = false;
      await service.window.setSize(PANEL_DOCK_COLLAPSED_SIZE);
      const size = await service.window.outerSize();
      const area = await workAreaForTargetPosition(targetPosition, size);
      if (!area) throw new Error("无法获取吸附面板所在工作区。");
      const nextPosition = targetPosition
        ? clampPanelDockPositionToWorkArea(targetPosition, size, area, settings.panelDock)
        : defaultTopRightPosition(size, area);
      await service.window.setPosition(nextPosition);
      return {
        mode: WIDGET_MODES.PANEL,
        position: nextPosition,
        ballDock: null,
        persistPosition: Boolean(targetPosition)
      };
    }

    state.panelDock = null;
    state.panelDockExpanded = false;
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
    return { ...settings, panelPosition: position, panelDock: normalizePanelDock(state.panelDock) };
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
    if (lifecycle.destroyed || generation !== windowModeGeneration) return;
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

  function destroy() {
    if (lifecycle.destroyed) return;
    lifecycle.destroy();
    window.clearTimeout(windowModeSettleTimer);
    windowModeSettleTimer = null;
    state.isApplyingWindowMode = false;
    panelController.clearPanelClick();
    ballController.destroy();
    positionController.destroy();
  }

  return {
    destroy,
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
