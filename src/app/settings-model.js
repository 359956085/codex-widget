import { DEFAULT_SETTINGS, LOG_LEVELS, THEMES, WIDGET_MODES } from "./constants.js";

export function normalizeSettings(settings) {
  const refreshIntervalMinutes = Number(settings?.refreshIntervalMinutes);
  const widgetMode = settings?.widgetMode === WIDGET_MODES.BALL ? WIDGET_MODES.BALL : WIDGET_MODES.PANEL;
  return {
    codexCliPath: typeof settings?.codexCliPath === "string" ? settings.codexCliPath : "",
    updateProxy: typeof settings?.updateProxy === "string" ? settings.updateProxy : "",
    refreshIntervalMinutes:
      Number.isInteger(refreshIntervalMinutes) && refreshIntervalMinutes >= 1 && refreshIntervalMinutes <= 1440
        ? refreshIntervalMinutes
        : DEFAULT_SETTINGS.refreshIntervalMinutes,
    locale: settings?.locale === "en" ? "en" : "zh",
    theme: normalizeTheme(settings?.theme),
    logLevel: normalizeLogLevel(settings?.logLevel),
    autoUpdateEnabled:
      typeof settings?.autoUpdateEnabled === "boolean" ? settings.autoUpdateEnabled : DEFAULT_SETTINGS.autoUpdateEnabled,
    autoStartEnabled:
      typeof settings?.autoStartEnabled === "boolean" ? settings.autoStartEnabled : DEFAULT_SETTINGS.autoStartEnabled,
    widgetMode,
    panelPosition: normalizeWindowPosition(settings?.panelPosition),
    ballPosition: normalizeWindowPosition(settings?.ballPosition),
    ballDock: normalizeBallDock(settings?.ballDock)
  };
}

export function normalizeWindowPosition(position) {
  if (!position || typeof position !== "object") return null;
  const x = Number(position.x);
  const y = Number(position.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return {
    x: Math.round(x),
    y: Math.round(y)
  };
}

export function normalizeBallDock(dock) {
  return dock === "left" || dock === "right" ? dock : null;
}

export function normalizeTheme(theme) {
  return Object.hasOwn(THEMES, theme) ? theme : DEFAULT_SETTINGS.theme;
}

export function normalizeLogLevel(logLevel) {
  return Object.hasOwn(LOG_LEVELS, logLevel) ? logLevel : DEFAULT_SETTINGS.logLevel;
}

export function normalizeInputValue(value) {
  const text = value.trim();
  return text ? text : null;
}
