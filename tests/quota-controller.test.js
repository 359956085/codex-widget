import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createQuotaController } from "../src/app/quota-controller.js";
import { createAppState } from "../src/app/state.js";

describe("额度刷新定时器", () => {
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

  it("刷新进行中不会启动第二个请求", async () => {
    const pendingQuota = deferred();
    const { controller, service, state } = createFixture(() => pendingQuota.promise);

    const first = controller.refreshQuota();
    const second = controller.refreshQuota();

    expect(service.commands.getQuota).toHaveBeenCalledTimes(1);
    pendingQuota.resolve(quotaResult());
    await Promise.all([first, second]);
    expect(state.loading).toBe(false);
  });

  it("按设置间隔自动刷新", async () => {
    const { controller, service, state } = createFixture(async () => quotaResult());
    state.settings.refreshIntervalMinutes = 1;

    controller.scheduleAutoRefresh();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(service.commands.getQuota).toHaveBeenCalledTimes(1);
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
  const controller = createQuotaController({
    state,
    service,
    render: vi.fn(),
    normalizeError: (error) => String(error),
    logger: { error: vi.fn() }
  });
  return { controller, service, state };
}

function quotaResult() {
  return {
    resetsAt: null,
    resetCredits: { expiries: [] }
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
