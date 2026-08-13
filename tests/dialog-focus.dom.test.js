// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { createDialogFocusManager } from "../src/app/dialog-focus.js";

describe("对话框焦点管理", () => {
  it("循环焦点、处理 Escape 并恢复原焦点", () => {
    document.body.innerHTML = `
      <button id="outside">打开</button>
      <section id="dialog" role="dialog">
        <button id="first">首项</button>
        <button id="last">末项</button>
      </section>
    `;
    const outside = document.getElementById("outside");
    const dialog = document.getElementById("dialog");
    const first = document.getElementById("first");
    const last = document.getElementById("last");
    const onEscape = vi.fn();
    const manager = createDialogFocusManager({ dialog, initialFocus: first, onEscape });
    manager.bindEvents();

    outside.focus();
    manager.activate();
    expect(document.activeElement).toBe(first);

    last.focus();
    pressKey(last, "Tab");
    expect(document.activeElement).toBe(first);
    pressKey(first, "Tab", true);
    expect(document.activeElement).toBe(last);
    pressKey(last, "Escape");
    expect(onEscape).toHaveBeenCalledOnce();

    manager.deactivate();
    expect(document.activeElement).toBe(outside);
  });
});

function pressKey(element, key, shiftKey = false) {
  element.dispatchEvent(new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true }));
}
