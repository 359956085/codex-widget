import { RESET_CREDIT_EXPIRY_DISPLAY_LIMIT } from "./constants.js";

export function selectedMeterWindow(quota, meterWindow) {
  if (!quota) return null;
  return meterWindow === "secondary" ? quota.secondary || null : quota.primary || null;
}

export function formatResetCredits(availableCount) {
  if (typeof availableCount === "number" && Number.isInteger(availableCount) && availableCount >= 0) {
    return String(availableCount);
  }
  return "--";
}

export function formatResetCreditExpiries(expiries, status) {
  if (status !== "success" || !Array.isArray(expiries) || expiries.length === 0) {
    return "--";
  }

  const values = expiries
    .map((value) => ({ value, time: new Date(value).getTime() }))
    .filter((item) => Number.isFinite(item.time))
    .sort((left, right) => left.time - right.time)
    .slice(0, RESET_CREDIT_EXPIRY_DISPLAY_LIMIT)
    .map((item) => formatRemainingDuration(item.time));
  return values.length ? values.join("/") : "--";
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
  return `${text.refreshedAt} ${fetchedAt}`;
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

function formatRemainingDuration(time) {
  const diff = time - Date.now();
  if (!Number.isFinite(diff) || diff <= 0) return "0m";

  const totalMinutes = Math.max(1, Math.ceil(diff / 60000));
  const days = Math.floor(totalMinutes / 1440);
  if (days >= 1) return `${days}d`;

  const hours = Math.floor(totalMinutes / 60);
  if (hours >= 1) return `${hours}h`;

  return `${totalMinutes}m`;
}

// 预存兼容代码暂不删除，仅排除未使用检查。
// eslint-disable-next-line no-unused-vars
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
