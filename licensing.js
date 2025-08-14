// licensing.js — simple “plan” layer for demo vs pro

const FREE_RULES = {
  daily_renders: null,      // za demo: bez dnevnog limita
  max_input_mb: 4096,
  watermark: true,          // sve slike/PDF dobijaju “Free” watermark
  delay_ms: 0,              // demo brz
  batch_limit_rows: 1,      // CSV batch ograničen na 1 red
  pdf_watermarked: true
};

const PRO_RULES = {
  daily_renders: null,
  max_input_mb: 10000,
  watermark: false,
  delay_ms: 0,
  batch_limit_rows: null,   // unlimited
  pdf_watermarked: false
};

function getQueryParams() {
  const params = {};
  const qs = window.location.search.substring(1);
  qs.split("&").forEach(part => {
    if (!part) return;
    const [k, v] = part.split("=");
    params[decodeURIComponent(k)] = decodeURIComponent(v || "");
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
  return isDevProEnabled() ? { name: "pro", rules: PRO_RULES } : { name: "free", rules: FREE_RULES };
}

function todayKey() { return new Date().toISOString().slice(0,10).replace(/-/g,""); }
function getRenderCount() { return parseInt(localStorage.getItem(`renderCount-${todayKey()}`) || "0", 10); }
export function incrementRenderCount(){ localStorage.setItem(`renderCount-${todayKey()}`, String(getRenderCount()+1)); }

export function canRender(fileSizeMB) {
  const { rules } = getPlan();
  if (fileSizeMB > rules.max_input_mb) return { allowed:false, reason:`Input exceeds ${rules.max_input_mb} MB limit.` };
  const plan = getPlan();
  if (plan.name === "free" && plan.rules.daily_renders !== null) {
    if (getRenderCount() >= plan.rules.daily_renders) return { allowed:false, reason:`Daily limit reached.` };
  }
  return { allowed:true };
}

export function shouldWatermark(){ return getPlan().rules.watermark; }
export function getDelay(){ return getPlan().rules.delay_ms; }
export function isPro(){ return getPlan().name === "pro"; }
export function getBatchLimit(){ return getPlan().rules.batch_limit_rows; }
export function isPdfWatermarked(){ return getPlan().rules.pdf_watermarked; }
