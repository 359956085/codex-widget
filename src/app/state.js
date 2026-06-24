import { DEFAULT_SETTINGS, WIDGET_MODES } from "./constants.js";
import { normalizeSettings, normalizeTheme } from "./settings-model.js";

export function createAppState() {
  return {
    settings: { ...DEFAULT_SETTINGS },
    settingsDraft: { ...DEFAULT_SETTINGS },
    locale: DEFAULT_SETTINGS.locale,
    quota: null,
    loading: false,
    error: "",
    alwaysOnTop: true,
    resetTimer: null,
    refreshTimer: null,
    updateStatus: null,
    updateChecking: false,
    updateTimer: null,
    latestStatusTimer: null,
    settingsOpen: false,
    savingSettings: false,
    widgetMode: DEFAULT_SETTINGS.widgetMode,
    ballDock: null,
    panelClick: null,
    ballPress: null,
    ballDrag: null,
    ballClickTimer: null,
    positionSaveTimer: null,
    windowMoveUnlisten: null,
    isApplyingWindowMode: false
  };
}

export function applyNormalizedSettings(state, settings, { syncDraft = true } = {}) {
  const normalized = normalizeSettings(settings);
  state.settings = normalized;
  state.locale = normalized.locale;
  state.widgetMode = normalized.widgetMode;
  state.ballDock = normalized.widgetMode === WIDGET_MODES.BALL ? normalized.ballDock : null;
  if (syncDraft) {
    syncSettingsDraftFromSettings(state);
  }
  return normalized;
}

export function syncSettingsDraftFromSettings(state) {
  state.settingsDraft = { ...state.settings };
}

export function renderLocale(state) {
  const locale = state.settingsOpen ? state.settingsDraft.locale : state.locale;
  return locale === "en" ? "en" : "zh";
}

export function renderTheme(state) {
  const theme = state.settingsOpen ? state.settingsDraft.theme : state.settings.theme;
  return normalizeTheme(theme);
}
