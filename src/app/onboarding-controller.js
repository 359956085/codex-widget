import { WIDGET_MODES } from "./constants.js";

const ONBOARDING_STEPS = [
  {
    titleKey: "onboardingModeTitle",
    descriptionKey: "onboardingModeDescription",
    target: "mode"
  },
  {
    titleKey: "onboardingSettingsTitle",
    descriptionKey: "onboardingSettingsDescription",
    target: "settings"
  },
  {
    titleKey: "onboardingRefreshTitle",
    descriptionKey: "onboardingRefreshDescription",
    target: "refresh"
  },
  {
    titleKey: "onboardingUpdateTitle",
    descriptionKey: "onboardingUpdateDescription",
    target: "version"
  }
];

export function createOnboardingController({
  els,
  state,
  renderLocale,
  renderTheme,
  applyNormalizedSettings,
  saveCurrentSettings,
  i18n
}) {
  let initialized = false;
  let completed = false;
  let currentStepIndex = 0;

  function bindEvents() {
    els.onboardingCloseBtn?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void completeOnboarding();
    });

    els.onboardingNextBtn?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      goToNextStep();
    });

    els.onboardingPrevBtn?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      goToPreviousStep();
    });
  }

  async function runInitialOnboarding() {
    if (initialized || state.settings.onboardingSeen) return;
    initialized = true;

    if (state.widgetMode !== WIDGET_MODES.PANEL || renderTheme() !== "default") {
      await completeOnboarding({ show: false });
      return;
    }

    showOnboarding();
  }

  function showOnboarding() {
    if (!els.onboardingOverlay) return;

    currentStepIndex = 0;
    els.onboardingOverlay.hidden = false;
    renderCurrentStep();
  }

  function renderCurrentStep() {
    const text = i18n[renderLocale()];
    const isLastStep = currentStepIndex === ONBOARDING_STEPS.length - 1;
    if (els.onboardingOverlay) {
      els.onboardingOverlay.dataset.onboardingStep = String(currentStepIndex);
    }
    const step = ONBOARDING_STEPS[currentStepIndex];
    if (els.onboardingTitle) {
      els.onboardingTitle.textContent = text[step.titleKey];
    }
    if (els.onboardingDescription) {
      els.onboardingDescription.textContent = text[step.descriptionKey];
    }
    if (els.onboardingPrevBtn) {
      els.onboardingPrevBtn.textContent = text.onboardingPrev;
      els.onboardingPrevBtn.disabled = currentStepIndex === 0;
    }
    if (els.onboardingNextBtn) {
      els.onboardingNextBtn.textContent = isLastStep ? text.onboardingDone : text.onboardingNext;
    }
    els.onboardingStepDots?.forEach((dot, index) => {
      dot.classList.toggle("active", index === currentStepIndex);
    });
    if (els.onboardingCloseBtn) {
      els.onboardingCloseBtn.dataset.tooltip = text.onboardingClose;
      els.onboardingCloseBtn.setAttribute("aria-label", text.onboardingClose);
      els.onboardingCloseBtn.textContent = text.close;
    }
    updateTargetPosition(step);
  }

  function updateTargetPosition(step) {
    const overlay = els.onboardingOverlay;
    const target = getStepTarget(step);
    if (!overlay || !target) return;

    const overlayRect = overlay.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    if (!overlayRect.width || !overlayRect.height || !targetRect.width || !targetRect.height) return;

    const centerX = targetRect.left - overlayRect.left + targetRect.width / 2;
    const centerY = targetRect.top - overlayRect.top + targetRect.height / 2;
    overlay.style.setProperty("--onboarding-target-x", `${roundCssPixel(centerX)}px`);
    overlay.style.setProperty("--onboarding-target-y", `${roundCssPixel(centerY)}px`);
  }

  function getStepTarget(step) {
    if (step.target === "mode") return els.modeBtn;
    if (step.target === "settings") return els.settingsBtn;
    if (step.target === "refresh") return els.refreshBtn;
    if (step.target === "version") {
      return els.versionBtn || document.getElementById("versionBtn") || document.querySelector(".version-badge") || els.brandName;
    }
    return null;
  }

  function roundCssPixel(value) {
    return Math.round(value * 10) / 10;
  }

  function goToNextStep() {
    if (currentStepIndex >= ONBOARDING_STEPS.length - 1) {
      void completeOnboarding();
      return;
    }

    currentStepIndex += 1;
    renderCurrentStep();
  }

  function goToPreviousStep() {
    if (currentStepIndex <= 0) return;

    currentStepIndex -= 1;
    renderCurrentStep();
  }

  async function completeOnboarding({ show = true } = {}) {
    if (completed) return;
    completed = true;
    if (show) hideOnboarding();
    applyNormalizedSettings({ ...state.settings, onboardingSeen: true }, { syncDraft: !state.settingsOpen });
    await saveCurrentSettings({ silent: true });
  }

  function hideOnboarding() {
    if (els.onboardingOverlay) {
      els.onboardingOverlay.hidden = true;
    }
  }

  return {
    bindEvents,
    runInitialOnboarding
  };
}
