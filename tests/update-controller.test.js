import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppState } from "../src/app/state.js";
import { createUpdateController } from "../src/app/update-controller.js";

describe("更新控制器", () => {
  it.each([false, true])("安装失败为 %s 时仍释放更新对象", async (fails) => {
    const update = {
      version: "9.9.9",
      close: vi.fn().mockResolvedValue(undefined),
      downloadAndInstall: vi.fn(async () => { if (fails) throw new Error("安装失败"); })
    };
    const fixture = createFixture(async () => update);
    await fixture.controller.checkForUpdates({ manual: true });
    expect(update.close).toHaveBeenCalledOnce();
    expect(fixture.state.updateStatus.type).toBe(fails ? "updateFailed" : "ready");
    fixture.controller.destroy();
  });

  it("资源关闭失败不覆盖安装成功状态", async () => {
    const fixture = createFixture(async () => ({
      version: "9.9.9",
      downloadAndInstall: async () => {},
      close: async () => { throw new Error("释放失败"); }
    }));
    await fixture.controller.checkForUpdates({ manual: true });
    expect(fixture.state.updateStatus.type).toBe("ready");
    expect(fixture.state.updateChecking).toBe(false);
    fixture.controller.destroy();
  });

  it("检查中销毁，迟到更新直接关闭且不启动安装", async () => {
    const pending = deferred();
    const update = { close: vi.fn(), downloadAndInstall: vi.fn() };
    const render = vi.fn();
    const fixture = createFixture(() => pending.promise, render);
    const running = fixture.controller.checkForUpdates({ manual: true });
    fixture.controller.destroy();
    fixture.controller.destroy();
    render.mockClear();
    pending.resolve(update);
    await running;
    expect(update.close).toHaveBeenCalledOnce();
    expect(update.downloadAndInstall).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
  });

  it("销毁不打断已开始的安装，迟到进度不再渲染", async () => {
    const installing = deferred();
    let progress;
    const update = {
      version: "9.9.9", close: vi.fn(),
      downloadAndInstall: vi.fn((handler) => { progress = handler; return installing.promise; })
    };
    const render = vi.fn();
    const fixture = createFixture(async () => update, render);
    const running = fixture.controller.checkForUpdates({ manual: true });
    await vi.waitFor(() => expect(update.downloadAndInstall).toHaveBeenCalledOnce());
    fixture.controller.destroy();
    render.mockClear();
    expect(update.close).not.toHaveBeenCalled();
    progress({ event: "Finished" });
    installing.resolve();
    await running;
    expect(update.close).toHaveBeenCalledOnce();
    expect(render).not.toHaveBeenCalled();
  });
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
      close: vi.fn(),
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
