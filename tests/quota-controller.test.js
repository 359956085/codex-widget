import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createQuotaController } from "../src/app/quota-controller.js";
import { createAppState } from "../src/app/state.js";

describe("额度刷新定时器", () => {
  it("销毁取消定时器和尾随刷新，迟到结果不覆盖快照", async () => {
    const pending = deferred();
    const { controller, service, state } = createFixture(() => pending.promise);
    const snapshot = quotaResult({ id: "old" });
    state.quota = snapshot;
    controller.scheduleAutoRefresh();
    const running = controller.refreshQuota();
    controller.refreshQuota();
    controller.destroy();
    controller.destroy();
    pending.resolve(quotaResult({ id: "late" }));
    await running;
    controller.scheduleAutoRefresh();
    await controller.refreshQuota();
    expect(state.quota).toBe(snapshot);
    expect(service.commands.getQuota).toHaveBeenCalledOnce();
    expect(state.refreshTimer).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("HTTP 过期时间迟到时不更新已销毁状态", async () => {
    const pending = deferred();
    const { controller, service, state } = createFixture(async () => ({ resetsAt: null }));
    service.commands.getResetCreditExpiries.mockReturnValue(pending.promise);
    await controller.refreshQuota();
    controller.destroy();
    pending.resolve({ expiries: ["2030-01-01T00:00:00Z"] });
    await Promise.resolve();
    expect(state.resetCreditExpiries).toEqual([]);
  });
  let originalWindow;

  beforeEach(() => {
    originalWindow = globalThis.window;
    vi.useFakeTimers();
    globalThis.window = globalThis;
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  });

  it("刷新进行中不会并发启动第二个请求", async () => {
    const pendingQuota = deferred();
    const { controller, service, state } = createFixture(() => pendingQuota.promise);

    const first = controller.refreshQuota();
    const second = controller.refreshQuota();

    expect(service.commands.getQuota).toHaveBeenCalledTimes(1);
    pendingQuota.resolve(quotaResult());
    await Promise.all([first, second]);
    expect(service.commands.getQuota).toHaveBeenCalledTimes(2);
    expect(state.loading).toBe(false);
  });

  it("忙碌期间多个请求只追加一次尾随刷新", async () => {
    const firstQuota = deferred();
    const secondQuota = deferred();
    const { controller, service, state } = createFixture(
      vi.fn()
        .mockImplementationOnce(() => firstQuota.promise)
        .mockImplementationOnce(() => secondQuota.promise)
    );

    const first = controller.refreshQuota();
    const second = controller.refreshQuota();
    const third = controller.refreshQuota();

    expect(service.commands.getQuota).toHaveBeenCalledOnce();
    firstQuota.resolve(quotaResult({ id: "first" }));
    await vi.waitFor(() => expect(service.commands.getQuota).toHaveBeenCalledTimes(2));
    secondQuota.resolve(quotaResult({ id: "latest" }));
    await Promise.all([first, second, third]);

    expect(service.commands.getQuota).toHaveBeenCalledTimes(2);
    expect(state.quota.id).toBe("latest");
    expect(state.loading).toBe(false);
  });

  it("失败保留旧快照且尾随刷新继续执行", async () => {
    const failedQuota = deferred();
    const latestQuota = deferred();
    const { controller, service, state, logger } = createFixture(
      vi.fn()
        .mockImplementationOnce(() => failedQuota.promise)
        .mockImplementationOnce(() => latestQuota.promise)
    );
    const previousQuota = quotaResult({ id: "previous" });
    state.quota = previousQuota;
    state.resetCreditExpiries = ["2026-01-01T00:00:00Z"];
    state.resetCreditExpiriesStatus = "success";

    const first = controller.refreshQuota();
    const trailing = controller.refreshQuota();
    failedQuota.reject(new Error("第一次失败"));
    await vi.waitFor(() => expect(service.commands.getQuota).toHaveBeenCalledTimes(2));

    expect(state.quota).toBe(previousQuota);
    expect(state.resetCreditExpiries).toEqual(["2026-01-01T00:00:00Z"]);
    latestQuota.resolve(quotaResult({ id: "latest" }));
    await Promise.all([first, trailing]);

    expect(state.quota.id).toBe("latest");
    expect(state.errors.quota).toBe("");
    expect(logger.error).toHaveBeenCalledOnce();
  });

  it("单次失败保留最后成功值和错误", async () => {
    const { controller, state } = createFixture(async () => {
      throw new Error("网络失败");
    });
    const previousQuota = quotaResult({ id: "previous" });
    state.quota = previousQuota;

    await controller.refreshQuota();

    expect(state.quota).toBe(previousQuota);
    expect(state.errors.quota).toContain("网络失败");
    expect(state.loading).toBe(false);
  });

  it("每五分钟刷新附属数据", async () => {
    const { controller, service } = createFixture(async () => quotaResult());

    controller.scheduleAutoRefresh();
    await vi.advanceTimersByTimeAsync(5 * 60_000);

    expect(service.commands.getQuota).toHaveBeenCalledTimes(1);
  });

  it("通知更新窗口且旧全量响应不会倒退", async () => {
    const pending = deferred();
    const { controller, state } = createFixture(() => pending.promise);
    const loading = controller.refreshQuota();
    controller.applyQuotaWindows({ revision: 8, primary: { remainingPercent: 40 }, secondary: null, remainingPercent: 40, usedPercent: 60, resetsAt: null, fetchedAt: "now" });
    pending.resolve(quotaResult({ windowsRevision: 7, primary: { remainingPercent: 70 }, resetCredits: { availableCount: 2, expiries: [] } }));
    await loading;
    expect(state.quota.primary.remainingPercent).toBe(40);
    expect(state.quota.resetCredits.availableCount).toBe(2);
    expect(state.quota.windowsRevision).toBe(8);
  });

  it("缓存读取晚于通知时不覆盖较新窗口", async () => {
    const { controller, service, state } = createFixture(async () => quotaResult());
    service.commands.getQuotaWindows = vi.fn(async () => ({ revision: 3, remainingPercent: 90 }));
    controller.applyQuotaWindows({ revision: 4, remainingPercent: 80 });
    await controller.readCachedWindows();
    expect(state.quota.remainingPercent).toBe(80);
  });
});

function createFixture(getQuota) {
  const state = createAppState();
  const service = {
    commands: {
      getQuota: vi.fn(getQuota),
      getResetCreditExpiries: vi.fn()
    }
  };
  const logger = { error: vi.fn() };
  const controller = createQuotaController({
    state,
    service,
    render: vi.fn(),
    normalizeError: (error) => String(error),
    logger
  });
  return { controller, service, state, logger };
}

function quotaResult(overrides = {}) {
  return {
    resetsAt: null,
    resetCredits: { expiries: [] },
    ...overrides
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, reject, resolve };
}
