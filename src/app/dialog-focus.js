const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled]):not([tabindex='-1'])",
  "textarea:not([disabled])",
  "a[href]",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

export function createDialogFocusManager({ dialog, initialFocus, onEscape }) {
  let restoreTarget = null;

  function bindEvents() {
    dialog?.addEventListener("keydown", handleKeyDown);
  }

  function activate() {
    restoreTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const target = resolveElement(initialFocus) || getFocusableElements(dialog)[0];
    target?.focus();
  }

  function deactivate() {
    const target = restoreTarget;
    restoreTarget = null;
    if (target?.isConnected) target.focus();
  }

  function handleKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      onEscape?.();
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = getFocusableElements(dialog);
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }

    const currentIndex = focusable.indexOf(document.activeElement);
    const shouldWrapBackward = event.shiftKey && currentIndex <= 0;
    const shouldWrapForward = !event.shiftKey && (currentIndex === -1 || currentIndex === focusable.length - 1);
    if (!shouldWrapBackward && !shouldWrapForward) return;

    // 对话框覆盖整个窗口，焦点不能落到被遮挡的主界面控件。
    event.preventDefault();
    focusable[shouldWrapBackward ? focusable.length - 1 : 0].focus();
  }

  return { activate, bindEvents, deactivate };
}

function resolveElement(elementOrFactory) {
  return typeof elementOrFactory === "function" ? elementOrFactory() : elementOrFactory;
}

function getFocusableElements(dialog) {
  if (!dialog) return [];
  return Array.from(dialog.querySelectorAll(FOCUSABLE_SELECTOR)).filter((element) => (
    element instanceof HTMLElement &&
    !element.hidden &&
    element.getAttribute("aria-hidden") !== "true"
  ));
}
