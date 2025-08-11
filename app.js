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

const presetSection = document.getElementById('presetSection');
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

async function loadPresets() {
  const resp = await fetch('./presets.json');
  presets = await resp.json();
}

function renderPresets() {
  // Clear existing content
  topPresetsContainer.innerHTML = '';
  otherPresetsContainer.innerHTML = '';
  // Determine top presets by fixed IDs
  const topIds = ['im_16mb', 'email_25mb', '9x16_1080_30'];
  const top = presets.filter(p => topIds.includes(p.id));
  const others = presets.filter(p => !topIds.includes(p.id));
  top.forEach(preset => {
    const card = createPresetCard(preset);
    topPresetsContainer.appendChild(card);
  });
  others.forEach(preset => {
    const card = createPresetCard(preset);
    otherPresetsContainer.appendChild(card);
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
  header.appendChild(title);
  header.appendChild(category);
  card.appendChild(header);
  // Add locked overlay if needed
  if (isPresetLocked(preset.id)) {
    card.classList.add('locked');
    const lock = document.createElement('div');
    lock.className = 'lock-icon';
    lock.innerHTML = '&#128274;';
    header.appendChild(lock);
  }
  // Add click handler
  card.addEventListener('click', async () => {
    if (isPresetLocked(preset.id)) {
      alert('This preset is available in the Pro plan.');
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

function renderCustomBuilder() {
  // If custom builder is disabled, show overlay and return.
  if (!isCustomEnabled()) {
    customLock.classList.remove('hidden');
    customPanel.innerHTML = '';
    return;
  }
  customLock.classList.add('hidden');
  // Build form elements for custom preset
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

  // Mode (size or quality)
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

  // Size target (MB) / CRF input depending on mode
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

  // CRF input (hidden by default; used for quality mode)
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

  // Submit button
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
    // Use rules for gating: custom builder is enabled if we got here
    await startProcessing(customPreset);
  });
  fragment.appendChild(btn);

  // Update UI based on mode selection
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

async function startProcessing(preset) {
  const fileSizeMB = selectedFile.size / (1024 * 1024);
  const permission = canRender(fileSizeMB);
  if (!permission.allowed) {
    alert(permission.reason);
    return;
  }
  // Optionally wait (free delay)
  const delay = getDelay();
  if (delay > 0) {
    progressSection.classList.remove('hidden');
    progressLabel.textContent = 'Preparing...';
    await new Promise(res => setTimeout(res, delay));
  }
  progressSection.classList.remove('hidden');
  progressBar.style.width = '0%';
  progressLabel.textContent = 'Loading encoder...';
  await ensureFFmpegLoaded();
  progressLabel.textContent = 'Reading video...';
  const inputData = await readFileAsArrayBuffer(selectedFile);
  // Determine video duration using HTMLVideoElement
  const durationSec = await getVideoDuration(selectedFile);
  progressLabel.textContent = 'Compressing...';
  const result = await compressVideo(preset, inputData, durationSec);
  // Save result file to download
  const blob = new Blob([result.buffer], { type: 'video/mp4' });
  const url = URL.createObjectURL(blob);
  resultVideo.src = url;
  downloadLink.href = url;
  downloadLink.download = generateDownloadName(selectedFile.name, preset);
  resultSection.classList.remove('hidden');
  progressSection.classList.add('hidden');
  // Save count
  incrementRenderCount();
  // Display nag for free plan
  const { name } = getPlan();
  if (name === 'free') {
    nagMessage.textContent =
      'Spremno! Trenutno 720p + watermark. Pro uskoro: bez watermarka, batch, ∞ rendersa.';
  } else {
    nagMessage.textContent = '';
  }
}

function generateDownloadName(originalName, preset) {
  const nameWithoutExt = originalName.replace(/\.[^.]+$/, '');
  return `${nameWithoutExt}-${preset.id}.mp4`;
}

async function ensureFFmpegLoaded() {
  if (ffmpegReady) return;
  // Dynamically import ffmpeg.wasm from unpkg; 0.12.1 version as of Feb 2025
  const { createFFmpeg, fetchFile } = await import('https://unpkg.com/@ffmpeg/ffmpeg@0.12.1/dist/ffmpeg.min.js?module');
  ffmpeg = createFFmpeg({ log: false, corePath: 'https://unpkg.com/@ffmpeg/core@0.12.1/dist/ffmpeg-core.js' });
  ffmpeg.setProgress(({ ratio }) => {
    const percent = Math.min(100, Math.floor(ratio * 100));
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

function buildFilter(preset) {
  let filters = [];
  // Scaling and aspect handling
  const aspect = preset.aspect;
  const fit = preset.fit;
  const maxHeight = preset.maxHeight;
  // Determine width and height for target frame
  let targetWidth = null;
  let targetHeight = null;
  if (maxHeight) {
    targetHeight = maxHeight;
    if (aspect && aspect !== 'keep') {
      const ratioMap = {
        '16:9': 16 / 9,
        '9:16': 9 / 16,
        '1:1': 1,
        '4:5': 4 / 5
      };
      const ratio = ratioMap[aspect];
      targetWidth = Math.round(maxHeight * ratio);
    }
  }
  if (!aspect || aspect === 'keep') {
    if (maxHeight) {
      // scale down preserving aspect
      filters.push(`scale=-2:${maxHeight}`);
    }
  } else if (fit === 'cover') {
    // Crop to fill aspect
    const w = targetWidth;
    const h = targetHeight;
    // first scale so smallest dimension fits, then crop
    filters.push(
      `scale=iw*max(${w}/iw\,${h}/ih):ih*max(${w}/iw\,${h}/ih),crop=${w}:${h}`
    );
  } else if (fit === 'contain') {
    const w = targetWidth;
    const h = targetHeight;
    filters.push(
      `scale=iw*min(${w}/iw\,${h}/ih):ih*min(${w}/iw\,${h}/ih),pad=${w}:${h}:((${w}-iw*min(${w}/iw\,${h}/ih))/2):(( ${h}-ih*min(${w}/iw\,${h}/ih))/2)`
    );
  }
  return filters.join(',');
}

async function compressVideo(preset, inputData, durationSec) {
  // Write input file to FS
  ffmpeg.FS('writeFile', 'input.mp4', inputData);
  // Build output args
  const args = ['-i', 'input.mp4'];
  // Frame rate
  if (preset.fps) {
    args.push('-r', preset.fps.toString());
  }
  // Build filter chain (scaling/cropping + optional watermark)
  let filterChain = buildFilter(preset);
  // Mode-specific encoding
  if (preset.mode === 'size') {
    // compute target bitrate (video) based on target size minus audio
    const targetBytes = preset.sizeTargetMB * 1024 * 1024;
    const audioBits = (preset.audioKbps || 128) * 1000 * durationSec;
    const videoBits = Math.max(
      300 * 1000 * durationSec,
      targetBytes * 8 - audioBits
    );
    const videoKbps = Math.floor(videoBits / durationSec / 1000);
    args.push('-b:v', `${videoKbps}k`);
    args.push('-maxrate', `${videoKbps}k`);
    args.push('-bufsize', `${videoKbps * 2}k`);
    args.push('-crf', (preset.crf || 23).toString());
  } else {
    // quality mode
    args.push('-crf', (preset.crf || 23).toString());
  }
  // Audio
  if (preset.audioKbps) {
    args.push('-b:a', `${preset.audioKbps}k`);
  }
  args.push('-c:a', 'aac');
  args.push('-movflags', 'faststart');
  // Apply watermark if needed (only in free plan)
  if (shouldWatermark()) {
    const watermarkText = 'VideoCompressor';
    const watermarkFilter = `drawtext=text='${watermarkText}':fontcolor=white@0.7:fontsize=24:x=10:y=h-40`;
    filterChain = filterChain ? `${filterChain},${watermarkFilter}` : watermarkFilter;
  }
  if (filterChain) {
    args.push('-vf', filterChain);
  }
  args.push('output.mp4');
  await ffmpeg.run(...args);
  const output = ffmpeg.FS('readFile', 'output.mp4');
  ffmpeg.FS('unlink', 'input.mp4');
  ffmpeg.FS('unlink', 'output.mp4');
  return output;
}

// Handle file input selection
document.getElementById('fileInput').addEventListener('change', (ev) => {
  const files = ev.target.files;
  if (files && files.length > 0) {
    selectedFile = files[0];
    resultSection.classList.add('hidden');
    progressSection.classList.add('hidden');
  }
});

// Share button
shareBtn.addEventListener('click', async () => {
  if (!downloadLink.href) return;
  try {
    if (navigator.share) {
      await navigator.share({
        title: 'Compressed video',
        url: downloadLink.href
      });
    } else {
      await navigator.clipboard.writeText(downloadLink.href);
      alert('Link copied to clipboard!');
    }
  } catch (err) {
    console.error(err);
  }
});

// Initialization
async function init() {
  await loadPresets();
  renderPresets();
  renderCustomBuilder();
  // Register service worker
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('./sw.js');
    } catch (err) {
      console.warn('Service worker registration failed', err);
    }
  }
}

init();