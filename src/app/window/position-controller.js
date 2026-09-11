import { createLifecycle } from "../lifecycle.js";
import { POSITION_SAVE_DEBOUNCE_MS, WIDGET_MODES } from "../constants.js";
import { normalizeBallDock, normalizeWindowPosition } from "../settings-model.js";

export function createPositionController({
  state,
  service,
  persistSettings,
  showError,
  logWindowError
}) {
  const lifecycle = createLifecycle();
  let registration = null;

  function registerWindowMoveSave() {
    if (!registration && !lifecycle.destroyed) {
      registration = registerMoveListener().finally(() => { registration = null; });
    }
    return registration ?? Promise.resolve();
  }

  async function registerMoveListener() {
    if (!service.isAvailable() || state.windowMoveUnlisten) return;

    try {
      const unlisten = await service.window.onMoved(() => {
        if (lifecycle.destroyed) return;
        if (state.isApplyingWindowMode || state.ballDrag) return;
        scheduleSaveCurrentWindowPosition();
      });
      if (!lifecycle.destroyed) state.windowMoveUnlisten = unlisten;
      lifecycle.add(unlisten);
    } catch (error) {
      logWindowError("监听窗口移动失败", error);
    }
  }

  function scheduleSaveCurrentWindowPosition() {
    if (lifecycle.destroyed || !service.isAvailable() || state.isApplyingWindowMode) return;
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
    if (lifecycle.destroyed || !service.isAvailable() || state.isApplyingWindowMode) return;

    try {
      const position = await readCurrentWindowPosition();
      if (!position) return;
      await persistWindowPosition(position, state.widgetMode, state.ballDock);
    } catch (error) {
      if (silent) {
        logWindowError("保存窗口位置失败", error);
      } else {
        logWindowError("保存窗口位置失败", error);
        showError(error);
      }
    }
  }

  async function persistWindowPosition(position, mode, dock = null) {
    await persistSettings((currentSettings) => {
      const nextSettings = { ...currentSettings };
      if (mode === WIDGET_MODES.BALL) {
        nextSettings.ballPosition = position;
        nextSettings.ballDock = normalizeBallDock(dock);
      } else {
        nextSettings.panelPosition = position;
      }
      return nextSettings;
    }, { syncDraft: !state.settingsOpen });
  }

  async function readCurrentWindowPosition() {
    clearPositionSaveTimer();
    if (lifecycle.destroyed || !service.isAvailable() || state.isApplyingWindowMode) return null;

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

  function destroy() {
    if (lifecycle.destroyed) return;
    lifecycle.destroy();
    clearPositionSaveTimer();
    state.windowMoveUnlisten = null;
  }

  return {
    destroy,
    clearPositionSaveTimer,
    mergeWindowPosition,
    persistWindowPosition,
    readCurrentWindowPosition,
    registerWindowMoveSave,
    saveCurrentWindowPosition,
    scheduleSaveCurrentWindowPosition
  };
}
