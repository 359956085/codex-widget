import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { newestFile } from "../scripts/latest-file.mjs";

describe("发布产物选择", () => {
  it("只读取匹配文件的元数据一次，同时间仍保持原目录顺序", () => {
    const entries = ["old.exe", "first.exe", "second.exe", "notes.txt", "folder.exe"];
    const fs = {
      existsSync: () => true,
      readdirSync: () => entries.map((name) => ({ name, isFile: () => name !== "folder.exe" })),
      statSync: vi.fn((file) => ({ mtimeMs: file.endsWith("old.exe") ? 1 : 2 }))
    };
    expect(newestFile("release", (name) => name.endsWith(".exe"), fs)).toBe(path.join("release", "first.exe"));
    expect(fs.statSync.mock.calls.map(([file]) => file)).toEqual(entries.slice(0, 3).map((name) => path.join("release", name)));
  });

  it("目录缺失或没有匹配文件时返回空", () => {
    expect(newestFile("missing", () => true, { existsSync: () => false })).toBeNull();
    expect(newestFile("empty", () => true, { existsSync: () => true, readdirSync: () => [] })).toBeNull();
  });
});
