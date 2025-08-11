// app.js
// Main logic for the Video Compressor Presets web app.

import {
  getPlan,
  canRender,
  incrementRenderCount,
  isPresetLocked,
  isCustomEnabled,
  shouldWatermark,
  getDelay
} from './licensing.js';

const topPresetsContainer = document.getElementById('topPresets');
const otherPresetsContainer = document.getElementById('otherPresets');
const customPanel = document.getElementById('customPanel');
const customLock = document.getElementById('customLock');
const progressSection = document.getElementById('progressSection');
const progressBar = document.getElementById('progressBar');
const progressLabel = document.getElementById('progressLabel');
const resultSection = document.getElementById('resultSection');
const resultVideo = document.getElementById('resultVideo');
const downloadLink = document.getElementById('downloadLink');
const shareBtn = document.getElementById('shareBtn');
const nagMessage = document.getElementById('nagMessage');

let presets = [];
let selectedFile = null;
let ffmpeg = null;
let ffmpegReady = false;

/* ---------- Toast (Pro hint) ---------- */
function showProToast(msg = 'This feature is available in Pro.') {
  const t = document.getElementById('proToast');
  const span = document.getElementById('proToastMsg');
  if (!t) return;
  if (span) span.textContent = ' ' + msg + ' ';
  t.classList.remove('hidden');
  clearTimeout(window.__proToastTimer);
  window.__proToastTimer = setTimeout(() => t.classList.add('hidden'), 2500);
}
function hideProToast() {
  const t = document.getElementById('proToast');
  if (t) t.classList.add('hidden');
  clearTimeout(window.__proToastTimer);
}
window.showProToast = showProToast;
window.hideProToast = hideProToast;

/* ---------- Tiny tooltip for preset cards (hover) ---------- */
const __tip = document.createElement('div');
Object.assign(__tip.style, {
  position: 'fixed',
  zIndex: 10000,
  display: 'none',
  maxWidth: '280px',
  padding: '8px 10px',
  borderRadius: '10px',
  background: 'rgba(18,23,35,0.95)',
  color: '#e8edf5',
  border: '1px solid rgba(255,255,255,0.1)',
  fontSize: '12.5px',
  lineHeight: '1.35',
  pointerEvents: 'none',
  boxShadow: '0 8px 24px rgba(0,0,0,0.35)'
});
document.body.appendChild(__tip);

function showTip(text, x, y) {
  __tip.textContent = text;
  __tip.style.display = 'block';
  const offset = 14;
  __tip.style.left = Math.min(x + offset, window.innerWidth - 300) + 'px';
  __tip.style.top  = Math.min(y + offset, window.innerHeight - 60) + 'px';
}
function hideTip(){ __tip.style.display = 'none'; }

/* ---------- Presets ---------- */
async function loadPresets() {
  const resp = await fetch('./presets.json');
  presets = await resp.json();
}

/* Grupisanje/sortiranje “ostalih” preseta — stabilno i predvidivo */
function groupRank(p) {
  const id = (p.id || '');
  if (id.startsWith('9x16_'))  return 0;  // Vertical
  if (id.startsWith('4x5_'))   return 1;  // Portrait
  if (id.startsWith('1x1_'))   return 2;  // Square
  if (id.startsWith('16x9_'))  return 3;  // Landscape
  if (id === 'discord_10mb' || id === 'discord_8mb') return 4;  // Discord
  if (id.startsWith('im_'))    return 5;  // Chat size-capped
  if (id.startsWith('email_')) return 6;  // Email size-capped
  if (id === 'source_friendly')return 7;  // Utility
  return 8;
}
function scoreByResFps(p) {
  const m = (p.id || '').match(/_(\d{3,4})(?:_(\d{2}))?$/);
  const res = m ? parseInt(m[1], 10) : (p.maxHeight || 0);
  const fps = m && m[2] ? parseInt(m[2], 10) : (p.fps || 0);
  const fpsBoost = (fps === 30 ? 2 : fps === 60 ? 1 : 0);
  return res * 100 + fpsBoost;
}
function sortOthers(arr) {
  return arr.slice().sort((a, b) => {
    // PRO (zaključani) gore radi konverzije
    const la = isPresetLocked(a.id) ? 0 : 1;
    const lb = isPresetLocked(b.id) ? 0 : 1;
    if (la !== lb) return la - lb;

    const ga = groupRank(a), gb = groupRank(b);
    if (ga !== gb) return ga - gb;

    const sa = scoreByResFps(a), sb = scoreByResFps(b);
    if (sa !== sb) return sb - sa;

    return (a.label || '').localeCompare(b.label || '');
  });
}

function renderPresets() {
  topPresetsContainer.innerHTML = '';
  otherPresetsContainer.innerHTML = '';

  // Top 3 FREE (fiksan redosled)
  const topIds = ['discord_8mb', 'email_25mb', 'quick_720p'];
  const byId = new Map(presets.map(p => [p.id, p]));
  topIds.forEach(id => {
    const p = byId.get(id);
    if (p) topPresetsContainer.appendChild(createPresetCard(p));
  });

  // Ostali sortirani deterministički
  const others = presets.filter(p => !topIds.includes(p.id));
  sortOthers(others).forEach(preset => {
    otherPresetsContainer.appendChild(createPresetCard(preset));
  });
}

function createPresetCard(preset) {
  const card = document.createElement('div');
  card.className = 'preset-card';

  const header = document.createElement('div');
  header.className = 'preset-header';

  const title = document.createElement('div');
  title.className = 'preset-title';
  title.textContent = preset.label;

  const category = document.createElement('div');
  category.className = 'preset-category';
  category.textContent = preset.category;

  // Header: title (left) — category (right)
  header.appendChild(title);
  header.appendChild(category);
  card.appendChild(header);

  // Hint uvek ispod headera (bez "i" dugmeta)
  if (preset.hint) {
    const hintEl = document.createElement('div');
    hintEl.className = 'preset-hint';
    hintEl.textContent = preset.hint;
    card.appendChild(hintEl);
  }

  const locked = isPresetLocked(preset.id);
  if (locked) {
    card.classList.add('locked');
    const lock = document.createElement('div');
    lock.className = 'lock-icon';
    lock.innerHTML = '&#128274;';
    // stavi pored kategorije (desno)
    header.appendChild(lock);
  }

  // Hover tooltip (desktop) — dodatno uz hint
  if (preset.hint) {
    card.title = preset.hint;
    card.addEventListener('mouseenter', e => showTip(preset.hint, e.clientX, e.clientY));
    card.addEventListener('mousemove',  e => showTip(preset.hint, e.clientX, e.clientY));
    card.addEventListener('mouseleave', hideTip);
  }

  card.addEventListener('click', async () => {
    if (locked) {
      showProToast('This preset is available in Pro.');
      return;
    }
    if (!selectedFile) {
      document.getElementById('fileInput').click();
      return;
    }
    await startProcessing(preset);
  });

  return card;
}

/* ---------- Custom builder ---------- */
function renderCustomBuilder() {
  if (!isCustomEnabled()) {
    customLock.classList.remove('hidden');
    customPanel.innerHTML = '';
    const learn = document.getElementById('learnMorePro');
    if (learn) learn.onclick = () => showProToast('Custom builder is available in Pro.');
    return;
  }

  customLock.classList.add('hidden');

  const fragment = document.createDocumentFragment();

  // Aspect ratio
  const aspectLabel = document.createElement('label');
  aspectLabel.textContent = 'Aspect ratio';
  const aspectSelect = document.createElement('select');
  aspectSelect.id = 'customAspect';
  ['keep','16:9','9:16','1:1','4:5'].forEach(value => {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = value === 'keep' ? 'Keep source' : value;
    aspectSelect.appendChild(opt);
  });
  fragment.appendChild(aspectLabel);
  fragment.appendChild(aspectSelect);

  // Fit
  const fitLabel = document.createElement('label');
  fitLabel.textContent = 'Fit';
  const fitSelect = document.createElement('select');
  fitSelect.id = 'customFit';
  ['cover','contain'].forEach(value => {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = value;
    fitSelect.appendChild(opt);
  });
  fragment.appendChild(fitLabel);
  fragment.appendChild(fitSelect);

  // Max height
  const heightLabel = document.createElement('label');
  heightLabel.textContent = 'Max height (px)';
  const heightInput = document.createElement('input');
  heightInput.type = 'number';
  heightInput.id = 'customMaxHeight';
  heightInput.placeholder = 'e.g. 1080';
  heightInput.min = 0;
  fragment.appendChild(heightLabel);
  fragment.appendChild(heightInput);

  // FPS
  const fpsLabel = document.createElement('label');
  fpsLabel.textContent = 'FPS';
  const fpsInput = document.createElement('input');
  fpsInput.type = 'number';
  fpsInput.id = 'customFps';
  fpsInput.placeholder = 'e.g. 30';
  fpsInput.min = 1;
  fragment.appendChild(fpsLabel);
  fragment.appendChild(fpsInput);

  // Mode
  const modeLabel = document.createElement('label');
  modeLabel.textContent = 'Mode';
  const modeSelect = document.createElement('select');
  modeSelect.id = 'customMode';
  ['size','quality'].forEach(value => {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = value.charAt(0).toUpperCase() + value.slice(1);
    modeSelect.appendChild(opt);
  });
  fragment.appendChild(modeLabel);
  fragment.appendChild(modeSelect);

  // Size target
  const sizeLabel = document.createElement('label');
  sizeLabel.id = 'customSizeLabel';
  sizeLabel.textContent = 'Target size (MB)';
  const sizeInput = document.createElement('input');
  sizeInput.type = 'number';
  sizeInput.id = 'customSizeTarget';
  sizeInput.placeholder = 'e.g. 50';
  sizeInput.min = 1;
  fragment.appendChild(sizeLabel);
  fragment.appendChild(sizeInput);

  // CRF
  const crfLabel = document.createElement('label');
  crfLabel.id = 'customCrfLabel';
  crfLabel.textContent = 'Quality (CRF)';
  crfLabel.style.display = 'none';
  const crfInput = document.createElement('input');
  crfInput.type = 'number';
  crfInput.id = 'customCrf';
  crfInput.placeholder = 'e.g. 23';
  crfInput.min = 1;
  crfInput.max = 51;
  crfInput.style.display = 'none';
  fragment.appendChild(crfLabel);
  fragment.appendChild(crfInput);

  // Audio bitrate
  const audioLabel = document.createElement('label');
  audioLabel.textContent = 'Audio (kbps)';
  const audioInput = document.createElement('input');
  audioInput.type = 'number';
  audioInput.id = 'customAudioKbps';
  audioInput.placeholder = 'e.g. 128';
  audioInput.min = 32;
  audioInput.step = 8;
  fragment.appendChild(audioLabel);
  fragment.appendChild(audioInput);

  // Submit
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn-primary';
  btn.textContent = 'Compress';
  btn.addEventListener('click', async () => {
    if (!selectedFile) {
      document.getElementById('fileInput').click();
      return;
    }
    const customPreset = {
      id: 'custom',
      label: 'Custom',
      category: 'Custom',
      mode: modeSelect.value,
      sizeTargetMB: Number(sizeInput.value) || 50,
      aspect: aspectSelect.value,
      fit: fitSelect.value,
      maxHeight: parseInt(heightInput.value, 10) || null,
      fps: parseInt(fpsInput.value, 10) || null,
      audioKbps: parseInt(audioInput.value, 10) || 128,
      crf: parseInt(crfInput.value, 10) || 23
    };
    await startProcessing(customPreset);
  });
  fragment.appendChild(btn);

  // Toggle size/quality inputs
  modeSelect.addEventListener('change', () => {
    const isSize = modeSelect.value === 'size';
    sizeLabel.style.display = isSize ? 'block' : 'none';
    sizeInput.style.display = isSize ? 'block' : 'none';
    crfLabel.style.display = isSize ? 'none' : 'block';
    crfInput.style.display = isSize ? 'none' : 'block';
  });

  customPanel.innerHTML = '';
  customPanel.appendChild(fragment);
}

/* ---------- Estimate helpers ---------- */
function formatMB(mb) {
  if (mb < 1) return `${Math.round(mb * 1024)} KB`;
  return `${Math.round(mb * 10) / 10} MB`;
}

/** Rough size estimate for size-mode presets. Returns {low, mid, high} in MB. */
function estimateSizeRangeMB(preset, durationSec) {
  if (preset.mode !== 'size' || !durationSec || !preset.sizeTargetMB) return null;
  const targetBytes = preset.sizeTargetMB * 1024 * 1024;
  const audioKbps = preset.audioKbps || 128;
  const audioBits = audioKbps * 1000 * durationSec;
  const videoBits = Math.max(300 * 1000 * durationSec, targetBytes * 8 - audioBits);
  const totalBits = videoBits + audioBits;
  const midMB = totalBits / 8 / 1024 / 1024;
  const lowMB = midMB * 0.9;
  const highMB = midMB * 1.1;
  return { low: lowMB, mid: midMB, high: highMB };
}

/* ---------- Processing ---------- */
async function startProcessing(preset) {
  const fileSizeMB = selectedFile.size / (1024 * 1024);
  const permission = canRender(fileSizeMB);
  if (!permission.allowed) {
    showProToast(permission.reason || 'Upgrade to Pro for this action.');
    return;
  }

  // === FREE 720p CAP (efektivni preset) ===
  const plan = getPlan();
  const p = { ...preset }; // clone to avoid mutating original
  if (plan.name === 'free') {
    const cap = (plan.rules && plan.rules.max_height) ? plan.rules.max_height : 720;
    if (!p.maxHeight || p.maxHeight > cap) p.maxHeight = cap;
  }

  // Show progress early
  progressSection.classList.remove('hidden');
  progressBar.style.width = '0%';

  // Read duration quickly (no ffmpeg) to estimate
  let durationSec = null;
  try {
    durationSec = await getVideoDuration(selectedFile);
  } catch (e) { /* ignore */ }

  // If size-mode, show rough estimate immediately
  if (p.mode === 'size' && durationSec) {
    const est = estimateSizeRangeMB(p, durationSec);
    if (est) {
      progressLabel.textContent = `Estimate: ≈${formatMB(est.low)}–${formatMB(est.high)} · Preparing…`;
    } else {
      progressLabel.textContent = 'Preparing...';
    }
  } else {
    progressLabel.textContent = 'Preparing...';
  }

  // Optional free delay
  const delay = getDelay();
  if (delay > 0) await new Promise(res => setTimeout(res, delay));

  progressLabel.textContent = 'Loading encoder...';
  await ensureFFmpegLoaded();

  progressLabel.textContent = 'Reading video...';
  const inputData = await readFileAsArrayBuffer(selectedFile);

  if (!durationSec) {
    try { durationSec = await getVideoDuration(selectedFile); } catch (e) {}
  }

  progressLabel.textContent = 'Compressing...';
  const result = await compressVideo(p, inputData, durationSec || 0);

  // Present result
  const blob = new Blob([result.buffer], { type: 'video/mp4' });
  const url = URL.createObjectURL(blob);
  resultVideo.src = url;
  downloadLink.href = url;
  downloadLink.download = generateDownloadName(selectedFile.name, p);
  resultSection.classList.remove('hidden');
  progressSection.classList.add('hidden');

  // Count + nags
  incrementRenderCount();
  const { name } = getPlan();
  nagMessage.textContent = (name === 'free')
    ? 'Spremno! Trenutno 720p + watermark. Pro uskoro: bez watermarka, batch, ∞ rendersa.'
    : '';
}

function generateDownloadName(originalName, preset) {
  const nameWithoutExt = originalName.replace(/\.[^.]+$/, '');
  return `${nameWithoutExt}-${preset.id}.mp4`;
}

async function ensureFFmpegLoaded() {
  if (ffmpegReady) return;
  const { createFFmpeg } = await import('https://unpkg.com/@ffmpeg/ffmpeg@0.12.1/dist/ffmpeg.min.js?module');
  ffmpeg = createFFmpeg({
    log: false,
    corePath: 'https://unpkg.com/@ffmpeg/core@0.12.1/dist/ffmpeg-core.js'
  });
  ffmpeg.setProgress(({ ratio }) => {
    const percent = Math.min(100, Math.floor((ratio || 0) * 100));
    progressBar.style.width = `${percent}%`;
    progressLabel.textContent = `Processing… ${percent}%`;
  });
  await ffmpeg.load();
  ffmpegReady = true;
}

async function readFileAsArrayBuffer(file) {
  return new Uint8Array(await file.arrayBuffer());
}

async function getVideoDuration(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.src = url;
    video.onloadedmetadata = () => {
      const dur = video.duration;
      URL.revokeObjectURL(url);
      resolve(dur);
    };
  });
}

/* Build -vf filter string for scale/crop/pad */
function buildFilter(preset) {
  const filters = [];
  const aspect = preset.aspect;
  const fit = preset.fit;
  const maxHeight = preset.maxHeight;

  let targetWidth = null;
  let targetHeight = null;

  if (maxHeight) {
    targetHeight = maxHeight;
    if (aspect && aspect !== 'keep') {
      const ratioMap = { '16:9': 16/9, '9:16': 9/16, '1:1': 1, '4:5': 4/5 };
      const ratio = ratioMap[aspect];
      targetWidth = Math.round(maxHeight * ratio);
    }
  }

  if (!aspect || aspect === 'keep') {
    if (maxHeight) {
      filters.push(`scale=-2:${maxHeight}`);
    }
  } else if (fit === 'cover') {
    const w = targetWidth;
    const h = targetHeight;
    filters.push(`scale=iw*max(${w}/iw,${h}/ih):ih*max(${w}/iw,${h}/ih),crop=${w}:${h}`);
  } else if (fit === 'contain') {
    const w = targetWidth;
    const h = targetHeight;
    filters.push(
      `scale=iw*min(${w}/iw,${h}/ih):ih*min(${w}/iw,${h}/ih),` +
      `pad=${w}:${h}:((${w}-iw*min(${w}/iw,${h}/ih))/2):((${h}-ih*min(${w}/iw,${h}/ih))/2)`
    );
  }

  return filters.join(',');
}

async function compressVideo(preset, inputData, durationSec) {
  ffmpeg.FS('writeFile', 'input.mp4', inputData);

  const argsBase = ['-i', 'input.mp4'];

  if (preset.fps) {
    argsBase.push('-r', String(preset.fps));
  }

  let filterChain = buildFilter(preset);

  if (preset.mode === 'size') {
    const targetBytes = (preset.sizeTargetMB || 25) * 1024 * 1024;
    const audioKbps = (preset.audioKbps || 128);
    const audioBits = audioKbps * 1000 * (durationSec || 0);
    const videoBits = Math.max(300 * 1000 * (durationSec || 0), targetBytes * 8 - audioBits);
    const videoKbps = Math.floor(videoBits / Math.max(1, durationSec) / 1000);

    argsBase.push('-b:v', `${videoKbps}k`, '-maxrate', `${videoKbps}k`, '-bufsize', `${videoKbps * 2}k`);
    argsBase.push('-crf', String(preset.crf || 23));
  } else {
    argsBase.push('-crf', String(preset.crf || 23));
  }

  if (preset.audioKbps) argsBase.push('-b:a', `${preset.audioKbps}k`);
  argsBase.push('-c:a', 'aac');
  argsBase.push('-movflags', 'faststart');

  if (shouldWatermark()) {
    const wm = `drawbox=x=10:y=H-50:w=180:h=36:color=white@0.14:t=fill`;
    filterChain = filterChain ? `${filterChain},${wm}` : wm;
  }
  const args = [...argsBase];
  if (filterChain) args.push('-vf', filterChain);
  args.push('output.mp4');

  await ffmpeg.run(...args);

  const output = ffmpeg.FS('readFile', 'output.mp4');
  ffmpeg.FS('unlink', 'input.mp4');
  ffmpeg.FS('unlink', 'output.mp4');
  return output;
}

/* ---------- File & Share ---------- */
document.getElementById('fileInput').addEventListener('change', (ev) => {
  const files = ev.target.files;
  if (files && files.length > 0) {
    selectedFile = files[0];
    resultSection.classList.add('hidden');
    progressSection.classList.add('hidden');
  }
});

shareBtn.addEventListener('click', async () => {
  if (!downloadLink.href) return;
  try {
    if (navigator.share) {
      await navigator.share({ title: 'Compressed video', url: downloadLink.href });
    } else {
      await navigator.clipboard.writeText(downloadLink.href);
      showProToast('Link copied to clipboard.');
    }
  } catch (err) {
    console.error(err);
  }
});

/* ---------- Init ---------- */
async function init() {
  await loadPresets();
  renderPresets();
  renderCustomBuilder();

  const learn = document.getElementById('learnMorePro');
  if (learn) learn.onclick = () => showProToast('Custom builder is available in Pro.');

  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('./sw.js');
    } catch (err) {
      console.warn('Service worker registration failed', err);
    }
  }
}

init();
