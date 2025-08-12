// app.js – eSIM QR Generator (offline)

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
const qrCanvas              = document.getElementById('qrCanvas');
const qrStringEl            = document.getElementById('qrString');
const downloadLink          = document.getElementById('downloadLink');
const shareBtn              = document.getElementById('shareBtn');
const nagMessage            = document.getElementById('nagMessage');
const planBadge             = document.getElementById('planBadge'); // može biti null

const learnBtn              = document.getElementById('learnMorePro');

let presets = [];
let selectedPresetId = null;

// ===== Learn modal =====
function openLearnModal(){ const d=document.getElementById('learnModal'); if(d && !d.open) d.showModal(); }
function closeLearnModal(){ const d=document.getElementById('learnModal'); if(d && d.open) d.close(); }
window.openLearnModal = openLearnModal; window.closeLearnModal = closeLearnModal;

// ===== Toasts =====
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
function showInfoToast(msg=''){
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
  if (t){ t.classList.add('hidden'); }
  clearTimeout(window.__proToastTimer);
}
window.hideProToast = hideProToast;

// ===== Tooltip (reuse) =====
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

// ===== Presets =====
async function loadPresets(){
  const resp = await fetch('./presets.json');
  presets = await resp.json();
}
function renderPresets(){
  topPresetsContainer.innerHTML='';
  otherPresetsContainer.innerHTML='';
  const topIds=['lpa_2part'];
  const byId = new Map(presets.map(p=>[p.id,p]));
  topIds.forEach(id=>{ const p=byId.get(id); if(p) topPresetsContainer.appendChild(createPresetCard(p)); });
  presets.filter(p=>!topIds.includes(p.id)).forEach(p=>otherPresetsContainer.appendChild(createPresetCard(p)));

  // auto-select first preset
  const first = document.querySelector('.preset-card');
  if (first){
    first.click();
  }
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

    card.title=preset.hint;
    card.addEventListener('mouseenter',e=>showTip(preset.hint,e.clientX,e.clientY));
    card.addEventListener('mousemove', e=>showTip(preset.hint,e.clientX,e.clientY));
    card.addEventListener('mouseleave',hideTip);
  }

  // Sve otključano za eSIM
  const locked = false;
  if (locked){
    card.classList.add('locked');
    const lock=document.createElement('div'); lock.className='lock-icon'; lock.innerHTML='&#128274;';
    header.appendChild(lock);
  }

  card.addEventListener('click', ()=>{
    if (locked){ showProToast('This preset is available in Pro.'); return; }
    selectedPresetId = preset.id;
    document.querySelectorAll('.preset-card.selected').forEach(el=>el.classList.remove('selected'));
    card.classList.add('selected');
    renderCustomBuilder();
  });

  return card;
}

// ===== Builder =====
function renderCustomBuilder(){
  // Builder je uvek dostupan (Pro gating ćemo koristiti za napredne opcije)
  customPanel.style.display='';
  customLock.classList.add('hidden');

  const p = presets.find(x=>x.id===selectedPresetId) || presets[0];

  // Napuni direktno #customPanel da grid radi (nema ugnježdene forme)
  customPanel.innerHTML = `
    <div>
      <label>SM-DP+ address</label>
      <input id="sdmp" placeholder="e.g. smdp.example.com" />
    </div>

    ${p.id==='lpa_3part'
      ? `<div><label>Matching ID</label><input id="match" placeholder="(optional)" /></div>`
      : `<input id="match" type="hidden" />`
    }

    <div>
      <label>Activation code</label>
      <input id="act" placeholder="e.g. 1234-5678-90AB-CDEF" />
    </div>

    <div>
      <label>Confirmation code (optional)</label>
      <input id="conf" placeholder="" />
    </div>

    <div>
      <label>Output size (px)</label>
      <input id="qrsize" type="number" min="128" value="512" />
    </div>

    <div>
      <label>Quiet zone (px)</label>
      <input id="qrmarg" type="number" min="0" value="8" />
    </div>

    <div style="grid-column:1/-1">
      <label>Raw string (editable)</label>
      <textarea id="raw" rows="3" class="mono"></textarea>
    </div>

    <div class="row" style="grid-column:1/-1">
      <button id="btnGen" class="btn btn-primary">Generate QR</button>
      <button id="btnClear" class="btn btn-secondary" type="button">Clear</button>
    </div>
  `;

  // refs
  const sdmp = customPanel.querySelector('#sdmp');
  const match= customPanel.querySelector('#match');
  const act  = customPanel.querySelector('#act');
  const conf = customPanel.querySelector('#conf');
  const raw  = customPanel.querySelector('#raw');
  const size = customPanel.querySelector('#qrsize');
  const marg = customPanel.querySelector('#qrmarg');
  const btnGen = customPanel.querySelector('#btnGen');
  const btnClear = customPanel.querySelector('#btnClear');

  function buildLPA(){
    const a = (sdmp?.value||'').trim();
    const m = (match?.value||'').trim();
    const c = (conf?.value||'').trim();
    const x = (act?.value||'').trim();

    const parts = ['LPA:1'];
    if (a) parts.push(a);
    if (p.id==='lpa_3part'){
      if (m) parts.push(m);
      if (x) parts.push(x);
    }else{
      if (x) parts.push(x);
    }
    if (c) parts.push(c);
    return parts.join('$');
  }

  function syncRaw(){ if (raw) raw.value = buildLPA(); }
  [sdmp, match, act, conf].forEach(inp => inp && inp.addEventListener('input', syncRaw));
  syncRaw();

  // enter = Generate
  [sdmp, match, act, conf, size, marg, raw].forEach(inp => {
    if (!inp) return;
    inp.addEventListener('keydown', (e)=>{
      if (e.key==='Enter' && !e.shiftKey){
        e.preventDefault();
        btnGen?.click();
      }
    });
  });

  btnClear?.addEventListener('click', ()=>{
    if (sdmp) sdmp.value = '';
    if (match) match.value = '';
    if (act) act.value = '';
    if (conf) conf.value = '';
    syncRaw();
    resultSection.classList.add('hidden');
    downloadLink.removeAttribute('href');
  });

  btnGen?.addEventListener('click', async ()=>{
    const plan = getPlan();
    if (planBadge) planBadge.textContent = (plan && plan.name) ? plan.name.toUpperCase() : '';

    // Monetizacija: koristimo postojeći canRender brojač (0 MB)
    const permission = canRender(0);
    if (!permission.allowed){
      showInfoToast(permission.reason);
      return;
    }

    const text = (raw?.value||'').trim();
    if (!text || !/^LPA:1\$/i.test(text)){
      showInfoToast('Enter valid LPA string (starts with LPA:1$)');
      return;
    }

    // Opcioni delay za free (UI countdown)
    const delay = getDelay();
    if (delay>0){
      progressSection.classList.remove('hidden');
      progressBar.style.width='0%';
      const start = Date.now();
      const end = start + delay;
      const tick=()=>{
        const left = Math.max(0, end-Date.now());
        const s = Math.ceil(left/1000);
        progressLabel.textContent = `Preparing… ${s}s`;
        const pct = Math.round(100*(1-left/delay));
        progressBar.style.width = `${pct}%`;
        if (left>0) requestAnimationFrame(tick);
      };
      tick();
      await new Promise(res=>setTimeout(res, delay));
      progressSection.classList.add('hidden');
    }

    // Render QR
    const px = Math.max(128, parseInt(size?.value,10)||512);
    const margin = Math.max(0, parseInt(marg?.value,10)||8);

    // clear canvas
    const ctx = qrCanvas.getContext('2d');
    ctx.clearRect(0,0,qrCanvas.width,qrCanvas.height);

    try{
      await QRCode.toCanvas(qrCanvas, text, {
        width: px,
        margin,
        errorCorrectionLevel: 'M'
      });

      // Watermark (Free)
      if (shouldWatermark()){
        const h = 22;
        const tmp = document.createElement('canvas');
        tmp.width = qrCanvas.width;
        tmp.height = qrCanvas.height + h + margin;
        const tctx = tmp.getContext('2d');
        tctx.fillStyle = '#fff';
        tctx.fillRect(0,0,tmp.width,tmp.height);
        tctx.drawImage(qrCanvas, 0,0);
        tctx.fillStyle = '#555';
        tctx.font = '14px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto';
        tctx.textAlign = 'center';
        tctx.fillText('Generated with eSIM QR (Free)', tmp.width/2, qrCanvas.height + 16);
        // re-copy nazad
        qrCanvas.width = tmp.width; qrCanvas.height = tmp.height;
        const ctx2 = qrCanvas.getContext('2d');
        ctx2.drawImage(tmp,0,0);
      }

      // Output / share
      const blob = await new Promise(res=>qrCanvas.toBlob(res, 'image/png'));
      const url = URL.createObjectURL(blob);
      downloadLink.href = url;
      downloadLink.download = 'esim-qr.png';
      qrStringEl.textContent = text;

      resultSection.classList.remove('hidden');
      incrementRenderCount();
      nagMessage.textContent = (getPlan().name==='free') ? 'Watermark is removed in Pro.' : '';
    }catch(e){
      console.error(e);
      showInfoToast('Failed to generate QR.');
    }
  });

  if (learnBtn) learnBtn.onclick = () => openLearnModal();
}

// ===== Share =====
shareBtn.addEventListener('click', async ()=>{
  const text = qrStringEl.textContent || '';
  if (!text) return;
  try{
    await navigator.clipboard.writeText(text);
    showInfoToast('LPA string copied to clipboard.');
  }catch(err){
    console.error(err);
  }
});

// ===== Init =====
async function init(){
  const plan = getPlan();
  if (planBadge) planBadge.textContent = (plan && plan.name) ? plan.name.toUpperCase() : '';

  await loadPresets();
  renderPresets();

  // fallback selekcija
  selectedPresetId = selectedPresetId || (presets[0] && presets[0].id) || null;
  if (!selectedPresetId) renderCustomBuilder();

  if ('serviceWorker' in navigator){
    try{ await navigator.serviceWorker.register('./sw.js'); }
    catch(err){ console.warn('Service worker registration failed', err); }
  }
}
init();
