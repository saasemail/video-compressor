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

const topPresetsContainer   = document.getElementById('topPresets');
const otherPresetsContainer = document.getElementById('otherPresets');
const customPanel           = document.getElementById('customPanel');
const customLock            = document.getElementById('customLock');

const progressSection       = document.getElementById('progressSection');
const progressBar           = document.getElementById('progressBar');
const progressLabel         = document.getElementById('progressLabel');

const resultSection         = document.getElementById('resultSection');
const resultVideo           = document.getElementById('resultVideo');
const downloadLink          = document.getElementById('downloadLink');
const shareBtn              = document.getElementById('shareBtn');
const nagMessage            = document.getElementById('nagMessage');

const chooseFileBtn         = document.getElementById('chooseFileBtn');
const compressBtn           = document.getElementById('compressBtn'); // may be null
const fileHint              = document.getElementById('fileHint');    // may be null
const fileInputEl           = document.getElementById('fileInput');

let presets = [];
let selectedFile = null;
let selectedPresetId = null;
let ffmpeg = null;
let ffmpegReady = false;
let __fflog = [];

/* ---------- Learn more modal ---------- */
function openLearnModal(){
  const d=document.getElementById('learnModal');
  if(d && !d.open) d.showModal();
}
function closeLearnModal(){
  const d=document.getElementById('learnModal');
  if(d && d.open) d.close();
}
window.openLearnModal = openLearnModal;
window.closeLearnModal = closeLearnModal;

/* ---------- Debug overlay (for failures) ---------- */
function showDebugOverlay(title, body) {
  const id='__dbg';
  let el=document.getElementById(id);
  if(!el){
    el=document.createElement('div'); el.id=id;
    Object.assign(el.style,{
      position:'fixed', inset:'0', background:'rgba(0,0,0,.75)',
      color:'#e8edf5', zIndex:99999, display:'flex', alignItems:'center', justifyContent:'center', padding:'20px'
    });
    const card=document.createElement('div');
    Object.assign(card.style,{
      width:'min(900px, 96vw)', maxHeight:'80vh', overflow:'auto',
      background:'#121723', border:'1px solid #ffffff1a', borderRadius:'14px', boxShadow:'0 10px 40px rgba(0,0,0,.5)'
    });
    const head=document.createElement('div');
    head.style.cssText='display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid #ffffff1a;';
    const h=document.createElement('div'); h.textContent=title||'Details';
    const x=document.createElement('button'); x.textContent='×';
    x.onclick=()=>el.remove();
    x.style.cssText='background:transparent;border:0;color:#e8edf5;font-size:20px;cursor:pointer;';
    head.appendChild(h); head.appendChild(x);
    const pre=document.createElement('pre');
    pre.style.cssText='font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; white-space:pre-wrap; padding:12px 16px; margin:0; font-size:12px; line-height:1.4; color:#cfe3ff;';
    pre.textContent = body||'';
    card.appendChild(head); card.appendChild(pre);
    el.appendChild(card);
    document.body.appendChild(el);
  }else{
    el.querySelector('pre').textContent = body||'';
  }
}

/* ---------- UI: Choose vs Compress ---------- */
function switchToChooseMode() {
  if (chooseFileBtn) chooseFileBtn.style.display = '';
  if (compressBtn)   compressBtn.style.display   = 'none';
  if (fileHint)      fileHint.style.display      = '';
  if (fileInputEl)   fileInputEl.value           = '';
  selectedFile = null;
  progressSection.classList.add('hidden');
}
function switchToCompressMode() {
  if (chooseFileBtn) chooseFileBtn.style.display = 'none';
  if (compressBtn)   compressBtn.style.display   = '';
  if (fileHint)      fileHint.style.display      = 'none';
}

/* ---------- Toasts ---------- */
function showProToast(msg='This feature is available in Pro.') {
  const t = document.getElementById('proToast'); if(!t) return;
  const span = document.getElementById('proToastMsg');
  const icon = t.querySelector('.toast-icon');
  const strong = t.querySelector('.toast-text strong');
  if (icon) icon.style.display = '';
  if (strong){ strong.textContent='Pro feature'; strong.style.display=''; }
  if (span) span.textContent = ' ' + msg + ' ';
  t.classList.remove('hidden');
  clearTimeout(window.__proToastTimer);
  window.__proToastTimer = setTimeout(hideProToast, 2200);
}
function showInfoToast(msg='') {
  const t = document.getElementById('proToast'); if(!t) return;
  const span = document.getElementById('proToastMsg');
  const icon = t.querySelector('.toast-icon');
  const strong = t.querySelector('.toast-text strong');
  if (icon) icon.style.display = 'none';
  if (strong) strong.style.display = 'none';
  if (span) span.textContent = ' ' + msg + ' ';
  t.classList.remove('hidden');
  clearTimeout(window.__proToastTimer);
  window.__proToastTimer = setTimeout(hideProToast, 2400);
}
function hideProToast(){
  const t = document.getElementById('proToast');
  if (t){
    t.classList.add('hidden');
    const icon = t.querySelector('.toast-icon');
    const strong = t.querySelector('.toast-text strong');
    if (icon) icon.style.display='';
    if (strong) strong.style.display='';
  }
  clearTimeout(window.__proToastTimer);
}
window.hideProToast = hideProToast;

/* ---------- Tooltip for preset cards ---------- */
const __tip = document.createElement('div');
Object.assign(__tip.style, {
  position:'fixed', zIndex:10000, display:'none', maxWidth:'280px',
  padding:'8px 10px', borderRadius:'10px', background:'rgba(18,23,35,0.95)',
  color:'#e8edf5', border:'1px solid rgba(255,255,255,0.1)', fontSize:'12.5px',
  lineHeight:'1.35', pointerEvents:'none', boxShadow:'0 8px 24px rgba(0,0,0,0.35)'
});
document.body.appendChild(__tip);
function showTip(text,x,y){
  __tip.textContent=text; __tip.style.display='block';
  const offset=14;
  __tip.style.left = Math.min(x+offset, window.innerWidth-300)+'px';
  __tip.style.top  = Math.min(y+offset, window.innerHeight-60)+'px';
}
function hideTip(){ __tip.style.display='none'; }

/* ---------- Presets ---------- */
async function loadPresets(){
  const resp = await fetch('./presets.json');
  presets = await resp.json();
}
function groupRank(p){
  const id = (p.id||'');
  if (id.startsWith('9x16_')) return 0;
  if (id.startsWith('4x5_' )) return 1;
  if (id.startsWith('1x1_' )) return 2;
  if (id.startsWith('16x9_')) return 3;
  if (id === 'discord_10mb' || id === 'discord_8mb') return 4;
  if (id.startsWith('im_' )) return 5;
  if (id.startsWith('email_')) return 6;
  if (id === 'source_friendly') return 7;
  return 8;
}
function scoreByResFps(p){
  const m = (p.id||'').match(/_(\d{3,4})(?:_(\d{2}))?$/);
  const res = m ? parseInt(m[1],10) : (p.maxHeight||0);
  const fps = m && m[2] ? parseInt(m[2],10) : (p.fps||0);
  const fpsBoost = (fps===30?2:(fps===60?1:0));
  return res*100 + fpsBoost;
}
function sortOthers(arr){
  return arr.slice().sort((a,b)=>{
    const la = isPresetLocked(a.id)?0:1;
    const lb = isPresetLocked(b.id)?0:1;
    if (la!==lb) return la-lb;
    const ga=groupRank(a), gb=groupRank(b);
    if (ga!==gb) return ga-gb;
    const sa=scoreByResFps(a), sb=scoreByResFps(b);
    if (sa!==sb) return sb-sa;
    return (a.label||'').localeCompare(b.label||'');
  });
}
function renderPresets(){
  topPresetsContainer.innerHTML='';
  otherPresetsContainer.innerHTML='';
  const topIds=['im_16mb','email_25mb','quick_720p'];
  const byId = new Map(presets.map(p=>[p.id,p]));
  topIds.forEach(id=>{ const p=byId.get(id); if(p) topPresetsContainer.appendChild(createPresetCard(p)); });
  const others = presets.filter(p=>!topIds.includes(p.id));
  sortOthers(others).forEach(p=>otherPresetsContainer.appendChild(createPresetCard(p)));
}
function createPresetCard(preset){
  const card = document.createElement('div');
  card.className='preset-card';
  card.dataset.presetId = preset.id;

  const header = document.createElement('div'); header.className='preset-header';
  const title  = document.createElement('div'); title.className='preset-title'; title.textContent=preset.label;
  const category=document.createElement('div'); category.className='preset-category'; category.textContent=preset.category;
  header.appendChild(title); header.appendChild(category);
  card.appendChild(header);

  if (preset.hint){
    const hintEl=document.createElement('div');
    hintEl.className='preset-hint';
    hintEl.textContent=preset.hint;
    card.appendChild(hintEl);
  }

  const locked = isPresetLocked(preset.id);
  if (locked){
    card.classList.add('locked');
    const lock=document.createElement('div'); lock.className='lock-icon'; lock.innerHTML='&#128274;';
    header.appendChild(lock);
  }

  if (preset.hint){
    card.title=preset.hint;
    card.addEventListener('mouseenter',e=>showTip(preset.hint,e.clientX,e.clientY));
    card.addEventListener('mousemove', e=>showTip(preset.hint,e.clientX,e.clientY));
    card.addEventListener('mouseleave',hideTip);
  }

  card.addEventListener('click', ()=>{
    if (locked){ showProToast('This preset is available in Pro.'); return; }
    selectedPresetId = preset.id;
    document.querySelectorAll('.preset-card.selected').forEach(el=>el.classList.remove('selected'));
    card.classList.add('selected');
    hideProToast();
  });

  return card;
}

/* ---------- Custom builder ---------- */
function renderCustomBuilder(){
  if (!isCustomEnabled()){
    customPanel.style.display='none';
    customPanel.innerHTML='';
    customLock.classList.remove('hidden');
    const learn=document.getElementById('learnMorePro');
    if (learn) learn.onclick = () => openLearnModal(); // always open modal
    return;
  }
  customPanel.style.display='';
  customLock.classList.add('hidden');

  const fragment = document.createDocumentFragment();

  const aspectLabel=document.createElement('label'); aspectLabel.textContent='Aspect ratio';
  const aspectSelect=document.createElement('select'); aspectSelect.id='customAspect';
  ['keep','16:9','9:16','1:1','4:5'].forEach(v=>{ const o=document.createElement('option'); o.value=v; o.textContent=(v==='keep'?'Keep source':v); aspectSelect.appendChild(o); });
  fragment.appendChild(aspectLabel); fragment.appendChild(aspectSelect);

  const fitLabel=document.createElement('label'); fitLabel.textContent='Fit';
  const fitSelect=document.createElement('select'); fitSelect.id='customFit';
  ['cover','contain'].forEach(v=>{ const o=document.createElement('option'); o.value=v; o.textContent=v; fitSelect.appendChild(o); });
  fragment.appendChild(fitLabel); fragment.appendChild(fitSelect);

  const heightLabel=document.createElement('label'); heightLabel.textContent='Max height (px)';
  const heightInput=document.createElement('input'); heightInput.type='number'; heightInput.id='customMaxHeight'; heightInput.placeholder='e.g. 1080'; heightInput.min=0;
  fragment.appendChild(heightLabel); fragment.appendChild(heightInput);

  const fpsLabel=document.createElement('label'); fpsLabel.textContent='FPS';
  const fpsInput=document.createElement('input'); fpsInput.type='number'; fpsInput.id='customFps'; fpsInput.placeholder='e.g. 30'; fpsInput.min=1;
  fragment.appendChild(fpsLabel); fragment.appendChild(fpsInput);

  const modeLabel=document.createElement('label'); modeLabel.textContent='Mode';
  const modeSelect=document.createElement('select'); modeSelect.id='customMode';
  ['size','quality'].forEach(v=>{ const o=document.createElement('option'); o.value=v; o.textContent=v[0].toUpperCase()+v.slice(1); modeSelect.appendChild(o); });
  fragment.appendChild(modeLabel); fragment.appendChild(modeSelect);

  const sizeLabel=document.createElement('label'); sizeLabel.id='customSizeLabel'; sizeLabel.textContent='Target size (MB)';
  const sizeInput=document.createElement('input'); sizeInput.type='number'; sizeInput.id='customSizeTarget'; sizeInput.placeholder='e.g. 50'; sizeInput.min=1;
  fragment.appendChild(sizeLabel); fragment.appendChild(sizeInput);

  const crfLabel=document.createElement('label'); crfLabel.id='customCrfLabel'; crfLabel.textContent='Quality (CRF)'; crfLabel.style.display='none';
  const crfInput=document.createElement('input'); crfInput.type='number'; crfInput.id='customCrf'; crfInput.placeholder='e.g. 23'; crfInput.min=1; crfInput.max=51; crfInput.style.display='none';
  fragment.appendChild(crfLabel); fragment.appendChild(crfInput);

  const audioLabel=document.createElement('label'); audioLabel.textContent='Audio (kbps)';
  const audioInput=document.createElement('input'); audioInput.type='number'; audioInput.id='customAudioKbps'; audioInput.placeholder='e.g. 128'; audioInput.min=32; audioInput.step=8;
  fragment.appendChild(audioLabel); fragment.appendChild(audioInput);

  const btn=document.createElement('button'); btn.type='button'; btn.className='btn btn-primary'; btn.textContent='Compress';
  btn.addEventListener('click', async ()=>{
    if (!selectedFile){ fileInputEl.click(); return; }
    const customPreset={
      id:'custom', label:'Custom', category:'Custom',
      mode: modeSelect.value,
      sizeTargetMB: Number(sizeInput.value)||50,
      aspect: aspectSelect.value,
      fit: fitSelect.value,
      maxHeight: parseInt(heightInput.value,10)||null,
      fps: parseInt(fpsInput.value,10)||null,
      audioKbps: parseInt(audioInput.value,10)||128,
      crf: parseInt(crfInput.value,10)||23
    };
    await startProcessing(customPreset);
  });
  fragment.appendChild(btn);

  modeSelect.addEventListener('change', ()=>{
    const isSize = modeSelect.value==='size';
    sizeLabel.style.display = isSize?'block':'none';
    sizeInput.style.display = isSize?'block':'none';
    crfLabel.style.display  = isSize?'none':'block';
    crfInput.style.display  = isSize?'none':'block';
  });

  customPanel.innerHTML=''; customPanel.appendChild(fragment);
}

/* ---------- Estimate helpers ---------- */
function formatMB(mb){ if(mb<1) return `${Math.round(mb*1024)} KB`; return `${Math.round(mb*10)/10} MB`; }
function estimateSizeRangeMB(preset, durationSec){
  if (preset.mode!=='size' || !durationSec || !preset.sizeTargetMB) return null;
  const targetBytes = preset.sizeTargetMB*1024*1024;
  const audioKbps = preset.audioKbps||128;
  const audioBits = audioKbps*1000*durationSec;
  const videoBits = Math.max(300*1000*durationSec, targetBytes*8 - audioBits);
  const totalBits = videoBits + audioBits;
  const midMB = totalBits/8/1024/1024;
  return { low: midMB*0.9, mid: midMB, high: midMB*1.1 };
}

/* ---------- FFmpeg plumbing ---------- */
function toEven(n){ if(n==null) return null; const i = Math.max(2, Math.round(n)); return (i%2===0)?i:(i-1); }
function buildFilter(preset){
  const filters=[];
  const aspect = preset.aspect;
  const fit    = preset.fit;
  let maxHeight = preset.maxHeight;
  let targetWidth=null, targetHeight=null;

  if (maxHeight){
    maxHeight = toEven(maxHeight);
    targetHeight = maxHeight;
    if (aspect && aspect!=='keep'){
      const ratioMap = {'16:9':16/9,'9:16':9/16,'1:1':1,'4:5':4/5};
      const ratio = ratioMap[aspect];
      targetWidth = toEven(maxHeight * ratio);
    }
  }

  if (!aspect || aspect==='keep'){
    if (maxHeight){ filters.push(`scale=-2:${maxHeight}`); }
  } else if (fit==='cover'){
    const w=targetWidth, h=targetHeight;
    filters.push(`scale=iw*max(${w}/iw\\,${h}/ih):ih*max(${w}/iw\\,${h}/ih),crop=${w}:${h}`);
  } else if (fit==='contain'){
    const w=targetWidth, h=targetHeight;
    filters.push(
      `scale=iw*min(${w}/iw\\,${h}/ih):ih*min(${w}/iw\\,${h}/ih),` +
      `pad=${w}:${h}:((${w}-iw*min(${w}/iw\\,${h}/ih))/2):((${h}-ih*min(${w}/iw\\,${h}/ih))/2)`
    );
  }

  if (shouldWatermark()){
    const wm = `drawbox=x=10:y=H-50:w=180:h=36:color=white@0.14:t=fill`;
    filters.push(wm);
  }
  return filters.join(',');
}

async function ensureFFmpegLoaded(){
  if (ffmpegReady) return;
  let createFFmpeg;
  try{
    ({ createFFmpeg } = await import('https://unpkg.com/@ffmpeg/ffmpeg@0.12.1/dist/ffmpeg.min.js?module'));
    // Prefer single-thread core for widest compatibility (no SharedArrayBuffer)
    ffmpeg = createFFmpeg({
      log: true,
      corePath: 'https://unpkg.com/@ffmpeg/core-st@0.12.1/dist/ffmpeg-core.js'
    });
  }catch(_e){
    ({ createFFmpeg } = await import('https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.1/dist/ffmpeg.min.js?module'));
    ffmpeg = createFFmpeg({
      log: true,
      corePath: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core-st@0.12.1/dist/ffmpeg-core.js'
    });
  }

  ffmpeg.setProgress(({ ratio })=>{
    const percent = Math.min(100, Math.floor((ratio||0)*100));
    progressBar.style.width = `${percent}%`;
    progressLabel.textContent = `Processing… ${percent}%`;
  });

  __fflog = [];
  ffmpeg.setLogger(({ type, message })=>{
    __fflog.push(`[${type}] ${message}`);
    if (__fflog.length>600) __fflog.shift();
  });

  await ffmpeg.load();
  ffmpegReady = true;
}

async function readFileAsArrayBuffer(file){ return new Uint8Array(await file.arrayBuffer()); }

async function getVideoDuration(file){
  return new Promise((resolve)=>{
    const url = URL.createObjectURL(file);
    const video=document.createElement('video');
    video.preload='metadata'; video.src=url;
    video.onloadedmetadata=()=>{ const d=video.duration; URL.revokeObjectURL(url); resolve(d); };
  });
}

/* ---------- Quick codec sniff (MP4) ---------- */
async function sniffCodec(file){
  // Read first ~2MB and search for fourcc strings
  const slice = file.slice(0, 2*1024*1024);
  const buf = new Uint8Array(await slice.arrayBuffer());
  const txt = new TextDecoder('latin1').decode(buf);
  if (/hvc1|hev1/i.test(txt)) return 'hevc';
  if (/avc1|avcC/i.test(txt)) return 'h264';
  if (/vp09/i.test(txt)) return 'vp9';
  return 'unknown';
}

/* ---------- Processing ---------- */
function startDelayCountdown(ms){
  const end = Date.now()+ms;
  const tick=()=>{
    const left = Math.max(0, end - Date.now());
    const s = Math.ceil(left/1000);
    progressLabel.textContent = `Preparing… ${s}s`;
    if (left>0) setTimeout(tick, 250);
  };
  tick();
}

async function compressWithArgs(args){
  const final = ['-y', ...args, '-threads', '1'];
  await ffmpeg.run(...final);
}

// Build video args based on codec + mode
function buildVideoArgsBase(preset, durationSec){
  const args = ['-i','input.mp4'];

  if (preset.fps) args.push('-r', String(preset.fps));

  const filterChain = buildFilter(preset);
  if (filterChain) args.push('-vf', filterChain);

  // Bitrate target for size mode
  let videoKbps = null;
  if (preset.mode==='size'){
    const targetBytes = (preset.sizeTargetMB||25)*1024*1024;
    const audioKbps   = (preset.audioKbps||128);
    const videoBits   = Math.max(300*1000*(durationSec||0), targetBytes*8 - audioKbps*1000*(durationSec||0));
    videoKbps         = Math.max(300, Math.floor(videoBits/Math.max(1,durationSec)/1000));
    args.push('-b:v', `${videoKbps}k`, '-maxrate', `${videoKbps}k`, '-bufsize', `${Math.max(600, videoKbps*2)}k`);
  }

  // Audio always AAC
  if (preset.audioKbps) args.push('-b:a', `${preset.audioKbps}k`);
  args.push('-c:a','aac','-movflags','faststart','-pix_fmt','yuv420p');

  return { args, videoKbps };
}

function applyCodecQualityArgs(args, preset, codec, videoKbps){
  // In size mode već imamo bitrate -> bez CRF/Q-scale dodataka
  if (preset.mode==='size'){
    if (codec==='libx264'){
      args.unshift('-preset','veryfast'); // put before -i not required, but fine anywhere before output
      args.unshift('-c:v','libx264');
    }else if (codec==='mpeg4'){
      args.unshift('-c:v','mpeg4');
      // no -crf here
    }
    return;
  }

  // quality mode
  if (codec==='libx264'){
    args.unshift('-crf', String(preset.crf||23));
    args.unshift('-preset','veryfast');
    args.unshift('-c:v','libx264');
  }else if (codec==='mpeg4'){
    const q = Math.min(31, Math.max(2, Math.round((preset.crf||23)/2))); // crude map CRF->qscale
    args.unshift('-q:v', String(q));
    args.unshift('-c:v','mpeg4');
  }
}

async function tryTranscode(preset, durationSec, codec){
  // clean any leftovers
  try{ ffmpeg.FS('unlink','output.mp4'); }catch(_){}
  const base = buildVideoArgsBase(preset, durationSec);
  const args = [...base.args, 'output.mp4'];
  applyCodecQualityArgs(args, preset, codec, base.videoKbps);
  await compressWithArgs(args);
}

async function compressVideo(preset, inputData, durationSec){
  // clean any leftovers
  try{ ffmpeg.FS('unlink','input.mp4'); }catch(_){}
  try{ ffmpeg.FS('unlink','output.mp4'); }catch(_){}
  ffmpeg.FS('writeFile','input.mp4', inputData);

  // 1) Try libx264
  try{
    await tryTranscode(preset, durationSec, 'libx264');
  }catch(e1){
    const logText = __fflog.join('\n');
    // if x264 missing OR crf not supported, fallback to mpeg4
    __fflog.push('[info] x264 path failed. Falling back to mpeg4…');
    try{
      await tryTranscode(preset, durationSec, 'mpeg4');
    }catch(e2){
      __fflog.push('[info] Transcode fallback failed. Trying remux (-c copy)…');
      // 3) Remux-only (-c copy) — last resort to verify pipeline
      try{
        // rewrite input, then copy
        try{ ffmpeg.FS('unlink','input.mp4'); }catch(_){}
        ffmpeg.FS('writeFile','input.mp4', inputData);
        await compressWithArgs(['-i','input.mp4','-c','copy','-movflags','faststart','output.mp4']);
      }catch(e3){
        const last = __fflog.slice(-120).join('\n');
        showDebugOverlay('FFmpeg log (last lines)', last);
        throw e1; // bubble original
      }
    }
  }

  const output = ffmpeg.FS('readFile','output.mp4');

  try{ ffmpeg.FS('unlink','input.mp4'); }catch(_){}
  try{ ffmpeg.FS('unlink','output.mp4'); }catch(_){}

  return output;
}

async function startProcessing(preset){
  try{
    const fileSizeMB = selectedFile.size/(1024*1024);
    const permission = canRender(fileSizeMB);
    if (!permission.allowed){
      showInfoToast(permission.reason);
      switchToChooseMode();
      return;
    }

    // Quick codec sniff — warn on HEVC (common iPhone)
    try{
      const c = await sniffCodec(selectedFile);
      if (c==='hevc'){
        showInfoToast('Your video is HEVC (H.265). Decoding may fail in the in-browser encoder.');
      }
    }catch(_){}

    // FREE 720p cap
    const plan = getPlan();
    const p = { ...preset };
    if (plan.name==='free'){
      const cap = (plan.rules && plan.rules.max_height) ? plan.rules.max_height : 720;
      if (!p.maxHeight || p.maxHeight>cap) p.maxHeight = cap;
    }

    // UI: progress visible
    progressSection.classList.remove('hidden');
    progressBar.style.width='0%';
    progressLabel.textContent='Preparing…';

    // duration (estimate)
    let durationSec = null;
    try{ durationSec = await getVideoDuration(selectedFile); }catch(_){}
    if (p.mode==='size' && durationSec){
      const est = estimateSizeRangeMB(p, durationSec);
      if (est){
        progressLabel.textContent = `Estimate: ≈${formatMB(est.low)}–${formatMB(est.high)} · Preparing…`;
      }
    }

    // Optional free delay (with countdown)
    const delay = getDelay();
    if (delay>0){ startDelayCountdown(delay); await new Promise(res=>setTimeout(res, delay)); }

    progressLabel.textContent='Loading encoder…';
    await ensureFFmpegLoaded();

    progressLabel.textContent='Reading video…';
    const inputData = await readFileAsArrayBuffer(selectedFile);

    if (!durationSec){ try{ durationSec = await getVideoDuration(selectedFile); }catch(_){} }

    progressLabel.textContent='Compressing… 0%';
    let result;
    try{
      result = await compressVideo(p, inputData, durationSec||0);
    }catch(errMain){
      const last = __fflog.slice(-160).join('\n');
      showDebugOverlay('FFmpeg log (last lines)', last);
      throw errMain;
    }

    // Present result
    const blob = new Blob([result], { type:'video/mp4' });
    const url = URL.createObjectURL(blob);
    resultVideo.src = url;
    downloadLink.href = url;
    downloadLink.download = generateDownloadName(selectedFile.name, p);
    resultSection.classList.remove('hidden');
    progressSection.classList.add('hidden');

    incrementRenderCount();

    const { name } = getPlan();
    nagMessage.textContent = (name==='free') ? '' : '';

    // stay in compress mode
  }catch(err){
    console.error('FFmpeg error:', err, __fflog.slice(-120).join('\n'));
    showInfoToast('Operation failed.');
    progressSection.classList.add('hidden');
    switchToChooseMode();
  }
}

function generateDownloadName(originalName, preset){
  const nameWithoutExt = originalName.replace(/\.[^.]+$/,'');
  return `${nameWithoutExt}-${preset.id}.mp4`;
}

/* ---------- File & Share ---------- */
chooseFileBtn.addEventListener('click',(e)=>{
  if (!selectedPresetId){
    e.preventDefault(); e.stopPropagation();
    showInfoToast('Select preset first.');
    return;
  }
  fileInputEl.click();
});

fileInputEl.addEventListener('change', async (ev)=>{
  const files = ev.target.files;
  if (!(files && files.length>0)) return;
  if (!selectedPresetId){
    ev.target.value=''; selectedFile=null;
    showInfoToast('Select preset first.');
    return;
  }
  selectedFile = files[0];
  resultSection.classList.add('hidden');
  progressSection.classList.add('hidden');
  switchToCompressMode();
});

if (compressBtn){
  compressBtn.addEventListener('click', async ()=>{
    if (!selectedFile){ showInfoToast('Choose a video first.'); return; }
    const chosen = presets.find(p=>p.id===selectedPresetId);
    if (!chosen){ showInfoToast('Preset not found. Try again.'); return; }
    await startProcessing(chosen);
  });
}

shareBtn.addEventListener('click', async ()=>{
  if (!downloadLink.href) return;
  try{
    if (navigator.share){
      await navigator.share({ title:'Compressed video', url:downloadLink.href });
    }else{
      await navigator.clipboard.writeText(downloadLink.href);
      showInfoToast('Link copied to clipboard.');
    }
  }catch(err){ console.error(err); }
});

/* ---------- Init ---------- */
async function init(){
  await loadPresets();
  renderPresets();
  renderCustomBuilder();

  const learn = document.getElementById('learnMorePro');
  if (learn) learn.onclick = () => openLearnModal();

  if ('serviceWorker' in navigator){
    try{ await navigator.serviceWorker.register('./sw.js'); }
    catch(err){ console.warn('Service worker registration failed', err); }
  }
}
init();
