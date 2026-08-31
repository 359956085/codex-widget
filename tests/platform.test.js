import { describe, expect, it } from "vitest";

import { isMacOSUserAgent } from "../src/app/platform.js";

describe("平台识别", () => {
  it("识别 macOS WebView User-Agent", () => {
    expect(isMacOSUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15")).toBe(true);
  });

  it("不把 Windows 和空值识别为 macOS", () => {
    expect(isMacOSUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe(false);
    expect(isMacOSUserAgent(null)).toBe(false);
  });
});
