import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppState } from "../src/app/state.js";
import { createUpdateController } from "../src/app/update-controller.js";

describe("更新控制器", () => {
  let originalWindow;

  beforeEach(() => {
    originalWindow = globalThis.window;
    globalThis.window = globalThis;
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  });

  it("检查保持单并发", async () => {
    const pending = deferred();
    const fixture = createFixture(() => pending.promise);

    const first = fixture.controller.checkForUpdates({ manual: true });
    const second = fixture.controller.checkForUpdates({ manual: true });
    expect(fixture.service.updater.check).toHaveBeenCalledOnce();

    pending.resolve(null);
    await Promise.all([first, second]);
    expect(fixture.state.updateChecking).toBe(false);
  });

  it("传入代理并正确汇总下载进度", async () => {
    const statuses = [];
    const update = {
      version: "9.9.9",
      async downloadAndInstall(onEvent) {
        onEvent({ event: "Started", data: { contentLength: 100 } });
        onEvent({ event: "Progress", data: { chunkLength: 40 } });
        onEvent({ event: "Progress", data: { chunkLength: 60 } });
        onEvent({ event: "Finished" });
      }
    };
    const fixture = createFixture(async () => update, (status) => statuses.push(status && { ...status }));
    fixture.state.settings.updateProxy = "http://127.0.0.1:7890";

    await fixture.controller.checkForUpdates({ manual: true });

    expect(fixture.service.updater.check).toHaveBeenCalledWith({ proxy: "http://127.0.0.1:7890" });
    expect(statuses).toContainEqual({ type: "downloading", percent: 40 });
    expect(statuses).toContainEqual({ type: "downloading", percent: 100 });
    expect(fixture.state.updateStatus).toEqual({ type: "ready" });
  });

  it("自动更新关闭时不发起后台检查", () => {
    const fixture = createFixture(async () => null);
    fixture.state.settings.autoUpdateEnabled = false;

    fixture.controller.scheduleUpdateChecks();

    expect(fixture.service.updater.check).not.toHaveBeenCalled();
    expect(fixture.state.updateTimer).toBeNull();
  });
});

function createFixture(check, onRender = () => {}) {
  const state = createAppState();
  const service = {
    isAvailable: () => true,
    updater: { check: vi.fn(check) }
  };
  const controller = createUpdateController({
    state,
    service,
    render: () => onRender(state.updateStatus),
    logger: { error: vi.fn() }
  });
  return { controller, service, state };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
