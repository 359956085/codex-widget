import { DEFAULT_SETTINGS } from "./constants.js";

export function createQuotaController({ state, service, render, normalizeError, logger }) {
  async function refreshQuota() {
    if (state.loading) return;

    state.loading = true;
    state.error = "";
    render();

    try {
      state.quota = await service.commands.getQuota();
      state.error = "";
      scheduleResetRefresh(state.quota?.resetsAt);
    } catch (error) {
      state.quota = null;
      scheduleResetRefresh(null);
      state.error = normalizeError(error);
      logger?.error("刷新数据失败", error, "frontend.quota");
    } finally {
      state.loading = false;
      render();
    }
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
