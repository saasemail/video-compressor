// licensing.js
// This module encapsulates plan detection (free vs pro) and gating logic.

const FREE_RULES = {
  daily_renders: 1,
  max_input_mb: 2048, // ↑ was 150 — bumped so Free works well even with larger phone clips
  max_height: 720,
  // >>> FREE preset whitelist (only these three are unlocked)
  presets_enabled: ["im_16mb", "email_25mb", "quick_720p"],
  // The rest are implicitly locked (informational here)
  presets_locked: [
    "email_10mb",
    "im_25mb",
    "im_50mb",
    "discord_8mb",
    "9x16_720_30",
    "9x16_1080_30",
    "9x16_1080_60",
    "16x9_720_30",
    "16x9_1080_30",
    "1x1_1080_30",
    "4x5_1080_30",
    "source_friendly",
    "custom"
  ],
  watermark: true,
  delay_ms: 60000,
  batch: 1,
  custom_builder_enabled: false
};

const PRO_RULES = {
  daily_renders: null,
  max_input_mb: 4000,
  max_height: 2160,
  presets_enabled: "all",
  watermark: false,
  delay_ms: 0,
  batch: 10,
  custom_builder_enabled: true
};

function getQueryParams() {
  const params = {};
  const queryString = window.location.search.substring(1);
  queryString.split("&").forEach(part => {
    const [key, value] = part.split("=");
    if (key) params[decodeURIComponent(key)] = decodeURIComponent(value || "");
  });
  return params;
}

function isDevProEnabled() {
  const params = getQueryParams();
  if (params.devPro === "1") {
    localStorage.setItem("devPro", "1");
    return true;
  }
  return localStorage.getItem("devPro") === "1";
}

export function getPlan() {
  if (isDevProEnabled()) {
    return { name: "pro", rules: PRO_RULES };
  }
  return { name: "free", rules: FREE_RULES };
}

function getRenderCount() {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return parseInt(localStorage.getItem(`renderCount-${today}`) || "0", 10);
}

export function incrementRenderCount() {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const key = `renderCount-${today}`;
  const current = getRenderCount();
  localStorage.setItem(key, (current + 1).toString());
}

export function canRender(fileSizeMB) {
  const { name, rules } = getPlan();
  if (fileSizeMB > rules.max_input_mb) {
    return { allowed: false, reason: `Input video exceeds ${rules.max_input_mb} MB limit for ${name} plan.` };
  }
  if (name === "free" && rules.daily_renders !== null) {
    if (getRenderCount() >= rules.daily_renders) {
      return { allowed: false, reason: `Daily render limit of ${rules.daily_renders} reached.` };
    }
  }
  return { allowed: true };
}

export function isPresetLocked(presetId) {
  const { rules } = getPlan();
  if (rules.presets_enabled === "all") return false;
  return rules.presets_enabled.indexOf(presetId) === -1;
}

export function isCustomEnabled() {
  const { rules } = getPlan();
  return rules.custom_builder_enabled;
}

export function shouldWatermark() {
  const { rules } = getPlan();
  return rules.watermark;
}

export function getDelay() {
  const { rules } = getPlan();
  return rules.delay_ms;
}
