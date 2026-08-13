// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createCustomSelectController } from "../src/app/custom-select.js";

describe("自定义选择器键盘交互", () => {
  let controller;
  let trigger;
  let select;
  let menu;
  let onChange;

  beforeEach(() => {
    document.body.innerHTML = `
      <span id="fieldLabel">主题</span>
      <div class="custom-select-shell">
        <select id="themeSelect" aria-labelledby="fieldLabel">
          <option value="a">甲</option>
          <option value="b">乙</option>
          <option value="c">丙</option>
        </select>
        <button class="custom-select-trigger" aria-labelledby="fieldLabel">
          <span class="custom-select-value"></span>
        </button>
        <div class="custom-select-menu"></div>
      </div>
    `;
    trigger = document.querySelector(".custom-select-trigger");
    select = document.querySelector("select");
    menu = document.querySelector(".custom-select-menu");
    onChange = vi.fn();
    controller = createCustomSelectController({
      shells: document.querySelectorAll(".custom-select-shell"),
      onChange
    });
    controller.bindEvents();
    controller.sync();
  });

  it("同步原生控件与 ARIA 语义", () => {
    expect(select.tabIndex).toBe(-1);
    expect(select.getAttribute("aria-hidden")).toBe("true");
    expect(trigger.getAttribute("role")).toBe("combobox");
    expect(trigger.getAttribute("aria-controls")).toBe(menu.id);
    expect(menu.getAttribute("role")).toBe("listbox");
    expect(menu.querySelectorAll('[role="option"]')).toHaveLength(3);
    expect(menu.querySelector('[aria-selected="true"]')?.dataset.value).toBe("a");
  });

  it("方向键移动活动项并用 Enter 选择", () => {
    pressKey(trigger, "ArrowDown");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    pressKey(trigger, "ArrowDown");
    expect(trigger.getAttribute("aria-activedescendant")).toBe("themeSelectOption1");
    pressKey(trigger, "Enter");

    expect(select.value).toBe("b");
    expect(onChange).toHaveBeenCalledWith("themeSelect", "b");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
  });

  it("支持 Home、End、Space、Escape 和 Tab", () => {
    pressKey(trigger, " ");
    pressKey(trigger, "End");
    expect(trigger.getAttribute("aria-activedescendant")).toBe("themeSelectOption2");
    pressKey(trigger, "Home");
    expect(trigger.getAttribute("aria-activedescendant")).toBe("themeSelectOption0");
    pressKey(trigger, "Escape");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    pressKey(trigger, "ArrowDown");
    pressKey(trigger, "Tab");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });
});

function pressKey(element, key) {
  element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}
