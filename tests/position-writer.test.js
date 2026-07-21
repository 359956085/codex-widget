import { describe, expect, it, vi } from "vitest";

import { createLatestPositionWriter } from "../src/app/window/position-writer.js";

describe("窗口位置单飞写入", () => {
  it("同时只执行一个写入并丢弃过期积压位置", async () => {
    const firstWrite = deferred();
    const calls = [];
    let activeWrites = 0;
    let maxActiveWrites = 0;
    const writer = createLatestPositionWriter(async (position) => {
      calls.push(position);
      activeWrites += 1;
      maxActiveWrites = Math.max(maxActiveWrites, activeWrites);
      if (calls.length === 1) await firstWrite.promise;
      activeWrites -= 1;
    }, vi.fn());

    writer.enqueue({ x: 10, y: 10 });
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    writer.enqueue({ x: 20, y: 20 });
    writer.enqueue({ x: 30, y: 30 });
    const idle = writer.whenIdle();

    expect(calls).toEqual([{ x: 10, y: 10 }]);
    firstWrite.resolve();
    await idle;

    expect(calls).toEqual([
      { x: 10, y: 10 },
      { x: 30, y: 30 }
    ]);
    expect(maxActiveWrites).toBe(1);
  });

  it("写入失败后继续处理最新位置", async () => {
    const onError = vi.fn();
    const writePosition = vi.fn()
      .mockRejectedValueOnce(new Error("IPC 失败"))
      .mockResolvedValueOnce();
    const writer = createLatestPositionWriter(writePosition, onError);

    writer.enqueue({ x: 1, y: 1 });
    await writer.whenIdle();
    writer.enqueue({ x: 2, y: 2 });
    await writer.whenIdle();

    expect(writePosition).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0][0]).toMatchObject({ message: "IPC 失败" });
  });

  it("whenIdle 等待进行中的写入", async () => {
    const pendingWrite = deferred();
    const writer = createLatestPositionWriter(() => pendingWrite.promise, vi.fn());
    let settled = false;

    writer.enqueue({ x: 1, y: 2 });
    const idle = writer.whenIdle().then(() => {
      settled = true;
    });
    await Promise.resolve();

    expect(settled).toBe(false);
    pendingWrite.resolve();
    await idle;
    expect(settled).toBe(true);
  });
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
