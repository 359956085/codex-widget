import { DEFAULT_SETTINGS } from "./constants.js";

export function createQuotaController({ state, service, render, normalizeError, logger }) {
  async function refreshQuota() {
    if (state.loading) return;

    state.loading = true;
    state.error = "";
    clearResetCreditExpiries("idle");
    render();

    try {
      state.quota = await service.commands.getQuota();
      state.error = "";
      scheduleResetRefresh(state.quota?.resetsAt);
      state.loading = false;
      render();
      refreshResetCreditExpiries();
    } catch (error) {
      state.quota = null;
      scheduleResetRefresh(null);
      state.error = normalizeError(error);
      state.loading = false;
      clearResetCreditExpiries("error");
      logger?.error("刷新数据失败", error, "frontend.quota");
      render();
    }
  }

  async function refreshResetCreditExpiries() {
    const requestId = state.resetCreditExpiriesRequestId + 1;
    state.resetCreditExpiriesRequestId = requestId;
    state.resetCreditExpiries = [];
    state.resetCreditExpiriesStatus = "loading";
    render();

    try {
      const result = await service.commands.getResetCreditExpiries();
      if (state.resetCreditExpiriesRequestId !== requestId) return;

      const expiries = Array.isArray(result?.expiries) ? result.expiries.slice(0, 5) : [];
      state.resetCreditExpiries = expiries;
      state.resetCreditExpiriesStatus = expiries.length ? "success" : "empty";
    } catch (error) {
      if (state.resetCreditExpiriesRequestId !== requestId) return;

      state.resetCreditExpiries = [];
      state.resetCreditExpiriesStatus = "error";
      logger?.error("读取重置次数过期时间失败", error, "frontend.quota.resetCredits");
    } finally {
      if (state.resetCreditExpiriesRequestId === requestId) {
        render();
      }
    }
  }

  function clearResetCreditExpiries(status) {
    state.resetCreditExpiriesRequestId += 1;
    state.resetCreditExpiries = [];
    state.resetCreditExpiriesStatus = status;
  }

  function scheduleResetRefresh(resetsAt) {
    if (state.resetTimer) {
      window.clearTimeout(state.resetTimer);
      state.resetTimer = null;
    }

    if (!resetsAt) return;
    const delay = new Date(resetsAt).getTime() - Date.now() + 1500;
    if (!Number.isFinite(delay) || delay <= 0) return;

    state.resetTimer = window.setTimeout(refreshQuota, Math.min(delay, refreshIntervalMs()));
  }

  function scheduleAutoRefresh() {
    if (state.refreshTimer) {
      window.clearInterval(state.refreshTimer);
      state.refreshTimer = null;
    }
    state.refreshTimer = window.setInterval(refreshQuota, refreshIntervalMs());
  }

  function refreshIntervalMs() {
    const minutes = Number(state.settings.refreshIntervalMinutes) || DEFAULT_SETTINGS.refreshIntervalMinutes;
    return Math.max(1, Math.min(1440, minutes)) * 60 * 1000;
  }

  return {
    refreshQuota,
    scheduleAutoRefresh
  };
}
