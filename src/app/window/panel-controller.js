import { PANEL_DOUBLE_CLICK_DISTANCE, PANEL_DOUBLE_CLICK_MS, WIDGET_MODES } from "../constants.js";

export function createPanelController({ state, service, setWidgetMode, startBallDrag, logWindowError }) {
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

  return {
    clearPanelClick,
    startWindowDrag
  };
}
