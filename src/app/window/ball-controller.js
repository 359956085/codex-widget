import { CLICK_DELAY_MS, WIDGET_MODES } from "../constants.js";
import {
  clamp,
  clampBallPositionToWorkArea,
  resolveSafeBallDock,
  workAreaBounds,
  workAreaForBallPosition
} from "../geometry.js";

export function createBallController({
  els,
  state,
  service,
  render,
  setWidgetMode,
  positionController,
  logWindowError
}) {
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

  async function snapBallAfterDrag(targetPosition = null) {
    if (!service.isAvailable()) return;

    try {
      const [monitors, position, size] = await Promise.all([
        service.window.availableMonitors(),
        service.window.outerPosition(),
        service.window.outerSize()
      ]);
      const dragPosition = targetPosition || position;
      const area = workAreaForBallPosition(dragPosition, size, monitors);
      if (!area) return;

      const dock = resolveSafeBallDock(dragPosition, size, area, monitors);
      const nextPosition = clampBallPositionToWorkArea(dragPosition, size, area, dock);
      state.ballDock = dock;
      await service.window.setPosition(nextPosition);
      await positionController.persistWindowPosition(nextPosition, WIDGET_MODES.BALL, dock);
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
      await positionController.persistWindowPosition(nextPosition, WIDGET_MODES.BALL, null);
      render();
    } catch (error) {
      logWindowError("展开悬浮球失败", error);
    }
  }

  return {
    clearBallClickTimer,
    expandBallFromDock,
    finishBallDrag,
    moveBallDrag,
    snapBallAfterDrag,
    startBallDrag
  };
}
