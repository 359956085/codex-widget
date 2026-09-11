// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { createLifecycle } from "../src/app/lifecycle.js";
import { createTooltipController } from "../src/app/tooltip-controller.js";
import { createPositionController } from "../src/app/window/position-controller.js";
import { createAppState } from "../src/app/state.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("实例资源生命周期", () => {
  it("重复绑定只执行一次，销毁后解绑并立即处理迟到资源", () => {
    const scope = createLifecycle();
    const callback = vi.fn();
    const cleanup = vi.fn();
    const button = document.createElement("button");
    for (let index = 0; index < 2; index++) {
      if (scope.bind()) scope.listen(button, "click", callback);
    }
    button.click();
    expect(callback).toHaveBeenCalledOnce();
    scope.destroy();
    scope.destroy();
    scope.add(cleanup);
    scope.guard(callback)();
    button.click();
    expect(callback).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(scope.bind()).toBe(false);
  });

  it("单项清理失败不阻断其余资源释放", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const scope = createLifecycle();
    const done = vi.fn();
    scope.add(() => { throw new Error("同步失败"); });
    scope.add(() => Promise.reject(new Error("异步失败")));
    scope.add(done);
    scope.destroy();
    await Promise.resolve();
    expect(done).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledTimes(2);
  });

  it("提示框销毁取消延时并删除节点", () => {
    vi.useFakeTimers();
    const target = document.createElement("button");
    target.dataset.tooltip = "提示";
    document.body.append(target);
    const tooltip = createTooltipController();
    tooltip.bindEvents();
    tooltip.bindEvents();
    target.dispatchEvent(new Event("pointerover", { bubbles: true }));
    expect(vi.getTimerCount()).toBe(1);
    tooltip.destroy();
    tooltip.destroy();
    target.dispatchEvent(new Event("pointerover", { bubbles: true }));
    vi.runAllTimers();
    expect(document.querySelector(".app-tooltip")).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("窗口移动监听注册期间销毁，迟到解除函数仍只执行一次", async () => {
    let resolve;
    let handler;
    const unlisten = vi.fn();
    const state = createAppState();
    const service = { isAvailable: () => true, window: {
      onMoved: vi.fn((callback) => { handler = callback; return new Promise((done) => { resolve = done; }); })
    } };
    const controller = createPositionController({ state, service, logWindowError: vi.fn() });
    const first = controller.registerWindowMoveSave();
    const second = controller.registerWindowMoveSave();
    controller.destroy();
    resolve(unlisten);
    await Promise.all([first, second]);
    handler();
    controller.destroy();
    expect(service.window.onMoved).toHaveBeenCalledOnce();
    expect(unlisten).toHaveBeenCalledOnce();
    expect(state.windowMoveUnlisten).toBeNull();
    expect(state.positionSaveTimer).toBeNull();
  });

  it("窗口移动监听注册失败后仍可重试", async () => {
    const unlisten = vi.fn();
    const onMoved = vi.fn().mockRejectedValueOnce(new Error("暂时失败")).mockResolvedValueOnce(unlisten);
    const state = createAppState();
    const controller = createPositionController({ state, service: { isAvailable: () => true, window: { onMoved } }, logWindowError: vi.fn() });
    await controller.registerWindowMoveSave();
    await controller.registerWindowMoveSave();
    await controller.registerWindowMoveSave();
    expect(onMoved).toHaveBeenCalledTimes(2);
    controller.destroy();
    expect(unlisten).toHaveBeenCalledOnce();
  });
});
