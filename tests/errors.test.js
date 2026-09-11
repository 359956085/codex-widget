import { describe, expect, it } from "vitest";
import { normalizeError } from "../src/app/errors.js";

describe("错误文本兼容", () => {
  it("保持原文和调用方的默认文案", () => {
    expect(normalizeError("失败")).toBe("失败");
    expect(normalizeError(new Error("失败"))).toBe("失败");
    expect(normalizeError({ code: 1 })).toBe('{"code":1}');
    expect(normalizeError(undefined)).toBe("未知错误");
    expect(normalizeError(undefined, "未知窗口错误")).toBe("未知窗口错误");
    const cyclic = {};
    cyclic.self = cyclic;
    expect(normalizeError(cyclic)).toBe("[object Object]");
  });
});
