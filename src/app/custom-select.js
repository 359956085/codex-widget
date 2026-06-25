export function createCustomSelectController({ shells = [], onChange } = {}) {
  const customSelectShells = Array.from(shells);

  function bindEvents() {
    customSelectShells.forEach((shell) => {
      const trigger = shell.querySelector(".custom-select-trigger");
      const menu = shell.querySelector(".custom-select-menu");
      const select = shell.querySelector("select");

      trigger?.addEventListener("click", (event) => {
        event.preventDefault();
        toggle(shell);
      });

      menu?.addEventListener("click", (event) => {
        const option = event.target instanceof Element ? event.target.closest(".custom-select-option") : null;
        if (!option) return;
        selectOption(shell, option.dataset.value || "");
      });

      if (select instanceof HTMLSelectElement) {
        select.addEventListener("change", () => {
          onChange?.(select.id, select.value);
          syncShell(shell);
        });
      }
    });

    document.addEventListener("pointerdown", (event) => {
      if (event.target instanceof Element && event.target.closest(".custom-select-shell")) return;
      close();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") close();
    });
  }

  function sync() {
    customSelectShells.forEach(syncShell);
  }

  function syncShell(shell) {
    const select = shell.querySelector("select");
    const trigger = shell.querySelector(".custom-select-trigger");
    const valueNode = shell.querySelector(".custom-select-value");
    const menu = shell.querySelector(".custom-select-menu");
    if (!(select instanceof HTMLSelectElement) || !trigger || !valueNode || !menu) return;

    const selectedOption = select.selectedOptions[0] || select.options[0];
    valueNode.textContent = selectedOption?.textContent || "";
    trigger.disabled = select.disabled;
    trigger.setAttribute("aria-expanded", shell.classList.contains("open") ? "true" : "false");

    const options = Array.from(select.options).map((option) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "custom-select-option";
      button.dataset.value = option.value;
      button.dataset.selected = option.value === select.value ? "true" : "false";
      button.textContent = option.textContent;
      if (option.value === select.value) {
        button.setAttribute("aria-current", "true");
      }
      return button;
    });
    menu.replaceChildren(...options);
  }

  function toggle(shell) {
    const shouldOpen = !shell.classList.contains("open");
    close(shell);
    shell.classList.toggle("open", shouldOpen);
    syncShell(shell);
  }

  function close(exceptShell = null) {
    customSelectShells.forEach((shell) => {
      if (shell !== exceptShell) shell.classList.remove("open");
      syncShell(shell);
    });
  }

  function selectOption(shell, value) {
    const select = shell.querySelector("select");
    if (!(select instanceof HTMLSelectElement)) return;

    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    close();
  }

  return {
    bindEvents,
    close,
    sync
  };
}
