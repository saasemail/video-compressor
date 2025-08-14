// licensing.js — simple Free vs Pro gating for this toolkit.
// Toggle Pro for dev testing with ?devPro=1 in URL (persists in localStorage).

const FREE_RULES = {
  daily_renders: 20,     // reasonable for testing
  watermark: true,
  delay_ms: 1500,        // small nudge in Free
  batch_rows: 1,         // batch limit
  pdf_enabled: false     // no PDF in Free
};

const PRO_RULES = {
  daily_renders: null,   // unlimited
  watermark: false,
  delay_ms: 0,
  batch_rows: Infinity,
  pdf_enabled: true
};

function getQueryParams() {
  const params = {};
  const queryString = window.location.search.substring(1);
  if (!queryString) return params;
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
  if (isDevProEnabled()) return { name: "pro", rules: PRO_RULES };
  return { name: "free", rules: FREE_RULES };
}
export function isPro(){ return getPlan().name === 'pro'; }

function todayKey(){ return new Date().toISOString().slice(0,10).replace(/-/g,''); }
function getRenderCount() {
  return parseInt(localStorage.getItem(`renderCount-${todayKey()}`) || "0", 10);
}
export function incrementRenderCount() {
  const key = `renderCount-${todayKey()}`;
  const current = getRenderCount();
  localStorage.setItem(key, (current + 1).toString());
}
export function canRender(_fileSizeMB) {
  const { name, rules } = getPlan();
  if (name === "free" && rules.daily_renders !== null) {
    if (getRenderCount() >= rules.daily_renders) {
      return { allowed: false, reason: `Daily limit of ${rules.daily_renders} reached.` };
    }
  }
  return { allowed: true };
}
export function shouldWatermark() { return getPlan().rules.watermark; }
export function getDelay() { return getPlan().rules.delay_ms; }
