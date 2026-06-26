export function selectedMeterWindow(quota, meterWindow) {
  if (!quota) return null;
  return meterWindow === "secondary" ? quota.secondary || null : quota.primary || null;
}

export function formatWindowLabel(minutes, fallbackLabel, text, locale) {
  if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes <= 0) return fallbackLabel;
  if (minutes % 10080 === 0) {
    const value = minutes / 10080;
    return locale === "zh" ? `${value}周窗口` : `${value}w window`;
  }
  if (minutes % 1440 === 0) {
    const value = minutes / 1440;
    return locale === "zh" ? `${value}天窗口` : `${value}d window`;
  }
  if (minutes % 60 === 0) {
    const value = minutes / 60;
    return locale === "zh" ? `${value}小时窗口` : `${value}h window`;
  }
  return locale === "zh" ? `${minutes}分钟窗口` : `${minutes}m window`;
}

export function statusLabel(quota, text, locale) {
  if (!quota) return text.noData;
  const fetchedAt = formatTimeOrPlaceholder(quota.fetchedAt, locale);
  const primaryResetAt = formatTimeOrPlaceholder(quota.primary?.resetsAt, locale);
  const secondaryResetAt = formatDateTimeOrPlaceholder(quota.secondary?.resetsAt, locale);
  return `${text.refreshedAt} ${fetchedAt} · ${text.primaryResetLabel} ${primaryResetAt} · ${text.secondaryResetLabel} ${secondaryResetAt}`;
}

export function getVisualState(remaining) {
  if (remaining === null) return "unknown";
  if (remaining === 0) return "empty";
  if (remaining <= 10) return "critical";
  if (remaining < 50) return "low";
  return "ready";
}

export function stateLabel(visualState, text) {
  if (visualState === "empty") return text.empty;
  if (visualState === "critical") return text.critical;
  if (visualState === "low") return text.low;
  if (visualState === "ready") return text.ready;
  return text.unavailable;
}

export function formatDate(value, locale) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

export function formatTimeOrPlaceholder(value, locale) {
  return value ? formatDate(value, locale) || "--" : "--";
}

export function formatDateTimeOrPlaceholder(value, locale) {
  return value ? formatMonthDayTime(value, locale) || "--" : "--";
}

function formatMonthDayTime(value, locale) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
    month: locale === "zh" ? "numeric" : "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

export function waterFillPercent(remaining, theme) {
  if (remaining === null) return 0;
  const value = clamp(remaining, 0, 100);
  if ((theme === "basic1" || theme === "basic2") && value > 0 && value < 20) return 18;
  return value;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
