import { describe, expect, it, vi } from "vitest";

import { bootstrapApplication, listenRuntimeEvent } from "../src/app/startup.js";

describe("应用启动容错", () => {
  it("捕获应用创建阶段的同步异常", async () => {
    const error = new Error("创建失败");
    const onFatalError = vi.fn();

    const started = await bootstrapApplication(() => {
      throw error;
    }, onFatalError);

    expect(started).toBe(false);
    expect(onFatalError).toHaveBeenCalledWith(error);
  });

  it("捕获应用启动阶段的异步异常", async () => {
    const error = new Error("初始化失败");
    const onFatalError = vi.fn();

    const started = await bootstrapApplication(
      () => ({ start: vi.fn().mockRejectedValue(error) }),
      onFatalError
    );

    expect(started).toBe(false);
    expect(onFatalError).toHaveBeenCalledWith(error);
  });

  it("单个事件监听失败不会拒绝启动流程", async () => {
    const error = new Error("监听失败");
    const onError = vi.fn();
    const successfulListen = vi.fn().mockResolvedValue(() => {});
    const failedListen = vi.fn().mockRejectedValue(error);

    const results = await Promise.all([
      listenRuntimeEvent(failedListen, "failed", vi.fn(), onError),
      listenRuntimeEvent(successfulListen, "success", vi.fn(), onError)
    ]);

    expect(results).toEqual([false, true]);
    expect(successfulListen).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(error);
  });

  it("错误处理函数自身失败也不会产生拒绝", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(bootstrapApplication(
      () => ({ start: vi.fn().mockRejectedValue(new Error("启动失败")) }),
      () => {
        throw new Error("错误处理失败");
      }
    )).resolves.toBe(false);

    expect(consoleError).toHaveBeenCalledOnce();
    consoleError.mockRestore();
  });
});
