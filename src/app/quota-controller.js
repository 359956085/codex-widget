import { createLifecycle } from "./lifecycle.js";
import { RESET_CREDIT_EXPIRY_DISPLAY_LIMIT } from "./constants.js";

const ANCILLARY_REFRESH_MS = 5 * 60 * 1000;

export function createQuotaController({ state, service, render, normalizeError, logger }) {
  const lifecycle = createLifecycle();
  render = lifecycle.guard(render);
  let activeRefresh = null;
  let refreshPending = false;

  function refreshQuota() {
    if (lifecycle.destroyed) return Promise.resolve();
    if (activeRefresh) {
      // 刷新参数来自最新设置；忙碌期间只需保留一次尾随刷新。
      refreshPending = true;
      return activeRefresh;
    }

    activeRefresh = drainQuotaRefreshes();
    return activeRefresh;
  }

  async function drainQuotaRefreshes() {
    let shouldRestart = false;
    try {
      do {
        refreshPending = false;
        if (lifecycle.destroyed) break;
        await refreshQuotaOnce();
      } while (refreshPending && !lifecycle.destroyed);
    } finally {
      activeRefresh = null;
      state.loading = false;
      render();
      shouldRestart = refreshPending;
    }

    // 防御 Promise 收尾与新事件同拍发生；不能把最后一次刷新留在队列外。
    if (shouldRestart) await refreshQuota();
  }

  async function refreshQuotaOnce() {
    startQuotaRefresh();
    render();

    try {
      const quota = await service.commands.getQuota();
      if (lifecycle.destroyed) return;
      applyQuotaSuccess(quota);
      const hasAppServerExpiries = applyAppServerResetCreditExpiries(quota);
      render();
      if (!hasAppServerExpiries) {
        refreshResetCreditExpiriesFromHttp();
      }
    } catch (error) {
      if (lifecycle.destroyed) return;
      applyQuotaError(error);
      render();
    }
  }

  function startQuotaRefresh() {
    state.loading = true;
    state.errors.quota = "";
    invalidateResetCreditExpiriesRequest();
  }

  function applyQuotaSuccess(quota) {
    const previous = state.quota;
    const previousRevision = Number(previous?.windowsRevision) || 0;
    const nextRevision = Number(quota?.windowsRevision) || 0;
    state.quota = previousRevision > nextRevision
      ? { ...quota, ...windowFields(previous) }
      : quota;
    state.errors.quota = "";
  }

  function windowFields(quota) {
    return {
      windowsRevision: quota.windowsRevision,
      primary: quota.primary,
      secondary: quota.secondary,
      remainingPercent: quota.remainingPercent,
      usedPercent: quota.usedPercent,
      resetsAt: quota.resetsAt,
      fetchedAt: quota.fetchedAt
    };
  }

  function applyQuotaWindows(update) {
    if (lifecycle.destroyed || !update || !Number.isSafeInteger(update.revision)) return;
    const previousRevision = Number(state.quota?.windowsRevision) || 0;
    if (update.revision <= previousRevision) return;
    state.quota = {
      ...state.quota,
      ...windowFields({ ...update, windowsRevision: update.revision })
    };
    state.errors.quota = "";
    render();
  }

  async function readCachedWindows() {
    if (lifecycle.destroyed || !service.commands.getQuotaWindows) return;
    try {
      applyQuotaWindows(await service.commands.getQuotaWindows());
    } catch (error) {
      logger?.error("读取额度窗口缓存失败", error, "frontend.quota");
    }
  }

  function applyQuotaError(error) {
    // 临时失败不能抹掉最后一次成功快照和对应重置时间。
    state.errors.quota = normalizeError(error);
    logger?.error("刷新数据失败", error, "frontend.quota");
  }

  function applyAppServerResetCreditExpiries(quota) {
    const expiries = quota?.resetCredits?.expiries;
    if (!Array.isArray(expiries)) return false;

    applyResetCreditExpiriesResult({ expiries });
    return true;
  }

  async function refreshResetCreditExpiriesFromHttp() {
    const requestId = startResetCreditExpiriesRequest();
    render();

    try {
      const result = await service.commands.getResetCreditExpiries();
      if (!isCurrentResetCreditExpiriesRequest(requestId)) return;

      applyResetCreditExpiriesResult(result);
    } catch (error) {
      if (!isCurrentResetCreditExpiriesRequest(requestId)) return;

      applyResetCreditExpiriesError(error);
    } finally {
      if (isCurrentResetCreditExpiriesRequest(requestId)) {
        render();
      }
    }
  }

  function startResetCreditExpiriesRequest() {
    const requestId = state.resetCreditExpiriesRequestId + 1;
    state.resetCreditExpiriesRequestId = requestId;
    state.resetCreditExpiries = [];
    state.resetCreditExpiriesStatus = "loading";
    return requestId;
  }

  function isCurrentResetCreditExpiriesRequest(requestId) {
    return !lifecycle.destroyed && state.resetCreditExpiriesRequestId === requestId;
  }

  function applyResetCreditExpiriesResult(result) {
    const expiries = Array.isArray(result?.expiries) ? result.expiries.slice(0, RESET_CREDIT_EXPIRY_DISPLAY_LIMIT) : [];
    state.resetCreditExpiries = expiries;
    state.resetCreditExpiriesStatus = expiries.length ? "success" : "empty";
  }

  function applyResetCreditExpiriesError(error) {
    state.resetCreditExpiries = [];
    state.resetCreditExpiriesStatus = "error";
    logger?.error("读取重置次数过期时间失败", error, "frontend.quota.resetCredits");
  }

  function invalidateResetCreditExpiriesRequest() {
    state.resetCreditExpiriesRequestId += 1;
  }

  function scheduleAutoRefresh() {
    if (lifecycle.destroyed) return;
    if (state.refreshTimer) {
      window.clearInterval(state.refreshTimer);
      state.refreshTimer = null;
    }
    state.refreshTimer = window.setInterval(refreshQuota, ANCILLARY_REFRESH_MS);
  }

  function destroy() {
    if (lifecycle.destroyed) return;
    lifecycle.destroy();
    refreshPending = false;
    invalidateResetCreditExpiriesRequest();
    window.clearInterval(state.refreshTimer);
    state.refreshTimer = null;
  }

  return {
    destroy,
    applyQuotaWindows,
    readCachedWindows,
    refreshQuota,
    scheduleAutoRefresh
  };
}
