// licensing.js
// This module encapsulates plan detection (free vs pro) and gating logic.

// Define the gating rules for the free and pro plans. These mimic the
// eventual configuration that will come from an external licensing service.
const FREE_RULES = {
  daily_renders: 1,
  max_input_mb: 150,
  max_height: 720,
  presets_enabled: ["im_16mb", "email_25mb", "quick_720p"],
  presets_locked: [
    "email_10mb",
    "im_25mb",
    "im_50mb",
    "9x16_1080_30",
    "9x16_1080_60",
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

/**
 * Parses the query string from the current location and returns an object.
 */
function getQueryParams() {
  const params = {};
  const queryString = window.location.search.substring(1);
  queryString.split("&").forEach(part => {
    const [key, value] = part.split("=");
    if (key) params[decodeURIComponent(key)] = decodeURIComponent(value || "");
  });
  return params;
}

/**
 * Detects whether pro mode is enabled by the developer via query string or by
 * some persisted flag. For now, we only support a dev query param. Future
 * integration with a real payment provider can replace this logic.
 */
function isDevProEnabled() {
  const params = getQueryParams();
  if (params.devPro === "1") {
    // Persist devPro flag so refreshing the page maintains pro mode.
    localStorage.setItem("devPro", "1");
    return true;
  }
  return localStorage.getItem("devPro") === "1";
}

/**
 * Returns the current plan ('free' or 'pro') along with its rule set.
 */
export function getPlan() {
  if (isDevProEnabled()) {
    return { name: "pro", rules: PRO_RULES };
  }
  // In the future, this section should verify an active subscription via
  // payment provider and return PRO_RULES accordingly.
  return { name: "free", rules: FREE_RULES };
}

/**
 * Returns the number of renders performed today. Uses localStorage with
 * date-scoped keys (YYYYMMDD) so counts reset daily. Free users are limited
 * to a certain number of renders per day.
 */
function getRenderCount() {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return parseInt(localStorage.getItem(`renderCount-${today}`) || "0", 10);
}

/**
 * Increments the daily render count. Should be called after a successful
 * processing job.
 */
export function incrementRenderCount() {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const key = `renderCount-${today}`;
  const current = getRenderCount();
  localStorage.setItem(key, (current + 1).toString());
}

/**
 * Returns whether the user is allowed to process another video based on
 * the plan's daily limit and file size. If the plan has unlimited renders,
 * this always returns true. Also checks the maximum input file size.
 *
 * @param {number} fileSizeMB Size of the selected file in megabytes.
 * @returns {object} { allowed: boolean, reason?: string }
 */
export function canRender(fileSizeMB) {
  const { name, rules } = getPlan();
  // Enforce file size limits
  if (fileSizeMB > rules.max_input_mb) {
    return { allowed: false, reason: `Input video exceeds ${rules.max_input_mb} MB limit for ${name} plan.` };
  }
  // Handle free plan daily limit
  if (name === "free" && rules.daily_renders !== null) {
    if (getRenderCount() >= rules.daily_renders) {
      return { allowed: false, reason: `Daily render limit of ${rules.daily_renders} reached.` };
    }
  }
  return { allowed: true };
}

/**
 * Checks if the given preset is locked for the current plan.
 *
 * @param {string} presetId ID of the preset.
 * @returns {boolean}
 */
export function isPresetLocked(presetId) {
  const { rules } = getPlan();
  if (rules.presets_enabled === "all") return false;
  return rules.presets_enabled.indexOf(presetId) === -1;
}

/**
 * Whether the custom builder is enabled for the current plan.
 */
export function isCustomEnabled() {
  const { rules } = getPlan();
  return rules.custom_builder_enabled;
}

/**
 * Returns whether a watermark should be applied.
 */
export function shouldWatermark() {
  const { rules } = getPlan();
  return rules.watermark;
}

/**
 * Returns the artificial delay to apply before starting processing (in ms).
 */
export function getDelay() {
  const { rules } = getPlan();
  return rules.delay_ms;
}