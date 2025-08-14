// app.js — Connectivity QR Toolkit (100% offline)
// Requires local vendor UMDs loaded before this module:
//   window.QRCode, window.jspdf.jsPDF, window.JSZip

import {
  getPlan,
  canRender,
  incrementRenderCount,
  shouldWatermark,
  getDelay,
  isPro
} from './licensing.js';

const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

// ===== Learn modal =====
function openLearnModal(){ const d=$('#learnModal'); if(d && !d.open) d.showModal(); }
function closeLearnModal(){ const d=$('#learnModal'); if(d && d.open) d.close(); }
window.openLearnModal = openLearnModal; window.closeLearnModal = closeLearnModal;

// ===== Toasts =====
function showProToast(msg='This feature is available in Pro.') {
  const t = $('#proToast'); if(!t) return;
  const span = $('#proToastMsg');
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
  const t = $('#proToast'); if(!t) return;
  const span = $('#proToastMsg');
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
  const t = $('#proToast');
  if (t){ t.classList.add('hidden'); }
  clearTimeout(window.__proToastTimer);
}
window.hideProToast = hideProToast;

// ===== i18n (EN default + SR toggle for a few strings) =====
const i18n = {
  en: {
    heroSubtitle: 'Offline, privacy-first. Build, validate, and print eSIM/Wi-Fi QR codes — no uploads.',
    heroHint: 'Free adds a watermark · Pro removes watermark and unlocks Batch/PDF',
  },
  sr: {
    heroSubtitle: 'Offline i privatno. Kreiraj, proveri i odštampaj eSIM/Wi-Fi QR kodove — bez slanja podataka.',
    heroHint: 'Free dodaje watermark · Pro uklanja watermark i otključava Batch/PDF',
  }
};
let lang = 'en';
const tset = () => {
  $('[data-i18n="heroSubtitle"]').textContent = i18n[lang].heroSubtitle;
  $('[data-i18n="heroHint"]').textContent = i18n[lang].heroHint;
};
$('#langToggle').addEventListener('click', ()=>{
  lang = (lang==='en' ? 'sr' : 'en');
  $('#langToggle').textContent = (lang==='en' ? 'SR' : 'EN');
  $('#langToggle').setAttribute('aria-pressed', lang==='sr' ? 'true' : 'false');
  tset();
});

// ===== Tabs =====
const tabBtns = $$('.tab-btn');
const panels = {
  presets: $('#tab-presets'),
  builder: $('#tab-builder'),
  batch:   $('#tab-batch'),
  export:  $('#tab-export'),
  validate:$('#tab-validate')
};
tabBtns.forEach(btn=>{
  btn.addEventListener('click', ()=>{
    tabBtns.forEach(b=>b.setAttribute('aria-selected','false'));
    btn.setAttribute('aria-selected','true');
    Object.values(panels).forEach(p=>p.classList.add('hidden'));
    panels[btn.dataset.tab].classList.remove('hidden');
    if (btn.dataset.tab==='builder') $('#customPanel')?.scrollIntoView({behavior:'smooth', block:'start'});
  });
});
$('#startNow').addEventListener('click', ()=>{
  tabBtns.find(b=>b.dataset.tab==='builder').click();
});

// ===== State =====
let presets = [];
let selectedPresetId = null;
let mode = 'esim'; // 'esim' | 'wifi'
let currentQRData = ''; // last generated content string
let currentPNGBlob = null;
let currentSVGText = null;

// ===== Elements =====
const progressSection = $('#progressSection');
const progressBar = $('#progressBar');
const progressLabel = $('#progressLabel');

const resultSection = $('#resultSection');
const qrCanvas = $('#qrCanvas');
const qrStringEl = $('#qrString');
const downloadPNG = $('#downloadPNG');
const downloadSVG = $('#downloadSVG');
const copyBtn = $('#copyBtn');
const nagMessage = $('#nagMessage');
const planBadge = $('#planBadge');

const printDot = $('#printDot');
const printMsg = $('#printMsg');

// ===== Presets (eSIM formats) =====
async function loadPresets(){
  const resp = await fetch('./presets.json');
  presets = await resp.json();
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

  card.addEventListener('click', ()=>{
    selectedPresetId = preset.id;
    $$('.preset-card.selected').forEach(el=>el.classList.remove('selected'));
    card.classList.add('selected');
    renderCustomBuilder();
  });

  return card;
}
function renderPresets(){
  const top = $('#topPresets'); const other = $('#otherPresets');
  top.innerHTML=''; other.innerHTML='';
  const topIds=['lpa_2part'];
  const byId = new Map(presets.map(p=>[p.id,p]));
  topIds.forEach(id=>{ const p=byId.get(id); if(p) top.appendChild(createPresetCard(p)); });
  presets.filter(p=>!topIds.includes(p.id)).forEach(p=>other.appendChild(createPresetCard(p)));

  const first = $('.preset-card');
  if (first){ first.click(); }
}

// ===== Helpers: LPA / Wi-Fi =====
function buildLPA({ presetId, sdmp, match, act, conf }) {
  const parts = ['LPA:1'];
  if (sdmp) parts.push(sdmp.trim());
  if (presetId==='lpa_3part'){
    if (match) parts.push(match.trim());
    if (act) parts.push(act.trim());
  } else {
    if (act) parts.push(act.trim());
  }
  if (conf) parts.push(conf.trim());
  return parts.join('$');
}
function validateLPA(str){
  // Accepts:
  // LPA:1$<smdp>$<activation>[$<confirmation>?]
  // LPA:1$<smdp>$<matching>$<activation>[$<confirmation>?]
  const okPrefix = /^LPA:1\$/i.test(str);
  if(!okPrefix) return { ok:false, reason:'Must start with LPA:1$' };
  const parts = str.split('$');
  // parts[0] = 'LPA:1'
  if (parts.length < 3) return { ok:false, reason:'Missing fields' };
  const smdp = parts[1] || '';
  if (!/^[A-Za-z0-9.\-+_:]+$/.test(smdp)) return { ok:false, reason:'Invalid SM-DP+ address' };

  // Determine 2- or 3-part
  let matching = '';
  let activation = '';
  let confirmation = '';
  if (parts.length >= 4) {
    // Could be 3-part
    if (parts[2] && parts[3]) {
      matching = parts[2];
      activation = parts[3];
      if (parts.length >= 5) confirmation = parts[4];
    } else {
      activation = parts[2];
      confirmation = parts[3] || '';
    }
  } else {
    activation = parts[2];
  }
  const actOK = /^[A-Za-z0-9\-._]+$/.test(activation);
  if(!actOK) return { ok:false, reason:'Invalid Activation Code' };

  if (confirmation && !/^[A-Za-z0-9\-._]+$/.test(confirmation)) {
    return { ok:false, reason:'Invalid Confirmation Code' };
  }
  return {
    ok:true,
    parts: { smdp, matching, activation, confirmation },
    format: matching ? '3part' : '2part'
  };
}
function parseWiFi(str){
  // WIFI:T:WPA;S:MySSID;P:pass;H:true;;
  if (!/^WIFI:/i.test(str)) return null;
  const out = { T:'', S:'', P:'', H:'' };
  str.replace(/^WIFI:/i,'').split(';').forEach(kv=>{
    const [k,v=''] = kv.split(':');
    if (k && k in out) out[k]=v;
  });
  return out;
}
function buildWiFi({ ssid, security, pass, hidden }){
  const T = (security||'WPA').toUpperCase(); // WPA, WPA2/WPA3
  const S = ssid||'';
  const P = pass||'';
  const H = hidden ? 'true' : 'false';
  return `WIFI:T:${T};S:${escapeWiFi(S)};P:${escapeWiFi(P)};H:${H};;`;
}
function escapeWiFi(s){ return (s||'').replace(/([;,:\\"])/g,'\\$1'); }

// ===== CSV (simple robust parser) =====
function parseCSV(text){
  const rows = [];
  let i=0, cell='', row=[], inQ=false;
  while(i<text.length){
    const c = text[i++];
    if (inQ){
      if (c===`"`) {
        if (text[i]==='"'){ cell+=`"`; i++; }
        else inQ=false;
      } else cell+=c;
    } else {
      if (c===`,`) { row.push(cell); cell=''; }
      else if (c===`\n`) { row.push(cell); rows.push(row); row=[]; cell=''; }
      else if (c===`\r`) { /* ignore */ }
      else if (c===`"`) { inQ=true; }
      else cell+=c;
    }
  }
  row.push(cell); rows.push(row);
  // normalize header
  const header = rows.shift().map(h=>h.trim().toLowerCase());
  return rows.filter(r=>r.some(x=>x.trim()!=='')).map(r=>{
    const obj={};
    header.forEach((h,idx)=>obj[h]= (r[idx]||'').trim());
    return obj;
  });
}

// ===== UI: Builder =====
function renderCustomBuilder(){
  const p = presets.find(x=>x.id===selectedPresetId) || presets[0];
  const cp = $('#customPanel');

  if (mode==='esim'){
    cp.innerHTML = `
      <div>
        <label for="sdmp">SM-DP+ address</label>
        <input id="sdmp" placeholder="smdp.example.com" autocomplete="off" />
      </div>
      ${p.id==='lpa_3part'
        ? `<div><label for="match">Matching ID</label><input id="match" placeholder="(optional)" autocomplete="off"/></div>`
        : `<input id="match" type="hidden" />`
      }
      <div>
        <label for="act">Activation code</label>
        <input id="act" placeholder="1234-5678-90AB-CDEF" autocomplete="off" />
      </div>
      <div>
        <label for="conf">Confirmation code (optional)</label>
        <input id="conf" placeholder="" autocomplete="off" />
      </div>
      <div style="grid-column:1/-1">
        <label for="raw">Raw string (editable)</label>
        <textarea id="raw" rows="3" class="mono" placeholder="LPA:1$..."></textarea>
      </div>
      <div class="row" style="grid-column:1/-1">
        <button id="btnGen" class="btn btn-primary">Generate QR</button>
        <button id="btnClear" class="btn btn-secondary" type="button">Clear</button>
      </div>
    `;
  } else {
    cp.innerHTML = `
      <div>
        <label for="ssid">SSID</label>
        <input id="ssid" placeholder="Network name" autocomplete="off" />
      </div>
      <div>
        <label for="sec">Security</label>
        <select id="sec">
          <option value="WPA">WPA/WPA2</option>
          <option value="WPA3">WPA3</option>
          <option value="nopass">No password</option>
        </select>
      </div>
      <div>
        <label for="wpass">Password</label>
        <input id="wpass" placeholder="" autocomplete="off" />
      </div>
      <div>
        <label for="hidden">Hidden</label>
        <select id="hidden">
          <option value="false">No</option>
          <option value="true">Yes</option>
        </select>
      </div>
      <div style="grid-column:1/-1">
        <label for="raw">Raw string (editable)</label>
        <textarea id="raw" rows="3" class="mono" placeholder="WIFI:T:..."></textarea>
      </div>
      <div class="row" style="grid-column:1/-1">
        <button id="btnGen" class="btn btn-primary">Generate QR</button>
        <button id="btnClear" class="btn btn-secondary" type="button">Clear</button>
      </div>
    `;
  }

  // refs
  const sdmp = $('#sdmp');
  const match= $('#match');
  const act  = $('#act');
  const conf = $('#conf');

  const ssid = $('#ssid');
  const sec  = $('#sec');
  const wpass= $('#wpass');
  const hidden=$('#hidden');

  const raw  = $('#raw');
  const btnGen = $('#btnGen');
  const btnClear = $('#btnClear');

  function syncRaw(){
    if (mode==='esim'){
      raw.value = buildLPA({
        presetId: p.id,
        sdmp: sdmp?.value||'',
        match: match?.value||'',
        act:   act?.value||'',
        conf:  conf?.value||'',
      });
    } else {
      const wifi = buildWiFi({
        ssid: ssid?.value||'',
        security: (sec?.value||'WPA'),
        pass: (sec?.value==='nopass'?'':(wpass?.value||'')),
        hidden: (hidden?.value==='true'),
      });
      raw.value = wifi;
    }
  }
  [sdmp, match, act, conf, ssid, sec, wpass, hidden].forEach(inp => inp && inp.addEventListener('input', syncRaw));

  if (mode==='esim'){
    // Default raw prefill if fields exist
    syncRaw();
  } else {
    // Default Wi-Fi raw
    syncRaw();
  }

  btnClear?.addEventListener('click', ()=>{
    [sdmp, match, act, conf, ssid, sec, wpass, hidden].forEach(inp=>{
      if(!inp) return;
      if (inp.tagName==='SELECT') inp.selectedIndex = 0;
      else inp.value='';
    });
    syncRaw();
    resultSection.classList.add('hidden');
    downloadPNG.removeAttribute('href');
    downloadSVG.removeAttribute('href');
    currentQRData=''; currentPNGBlob=null; currentSVGText=null;
    updatePrintIndicator(null);
  });

  btnGen?.addEventListener('click', ()=> handleGenerate(raw.value));
}

// ===== QR generation / exports =====
async function handleGenerate(text){
  const plan = getPlan();
  if (planBadge) planBadge.textContent = plan.name.toUpperCase();

  const permission = canRender(0);
  if (!permission.allowed){ showInfoToast(permission.reason); return; }

  const ecc = $('#ecc').value || 'M';
  const version = parseInt($('#version').value,10) || 0;
  const px = Math.max(128, parseInt($('#qrsize').value,10)||512);
  const margin = Math.max(0, parseInt($('#qrmarg').value,10)||8);

  // Validation for eSIM when applicable
  if (/^LPA:1\$/i.test(text)) {
    const v = validateLPA(text);
    const status = v.ok ? 'OK' : ('Error: ' + v.reason);
    showInfoToast('LPA check: ' + status);
    if (!v.ok) return;
  }

  // Optional delay for free
  const delay = getDelay();
  if (delay>0){
    progressSection.classList.remove('hidden');
    progressBar.style.width='0%';
    const start = Date.now(); const end = start + delay;
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

  // Render PNG
  const ctx = qrCanvas.getContext('2d');
  ctx.clearRect(0,0,qrCanvas.width,qrCanvas.height);

  try{
    await window.QRCode.toCanvas(qrCanvas, text, {
      width: px, margin, errorCorrectionLevel: ecc, ...(version>0?{version}:{}),
      color: { dark: '#000000', light: '#FFFFFF' }
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
      tctx.fillText('Generated with Connectivity QR (Free)', tmp.width/2, qrCanvas.height + 16);
      qrCanvas.width = tmp.width; qrCanvas.height = tmp.height;
      const ctx2 = qrCanvas.getContext('2d');
      ctx2.drawImage(tmp,0,0);
    }

    // Blob PNG
    currentPNGBlob = await new Promise(res=>qrCanvas.toBlob(res, 'image/png'));
    downloadPNG.href = URL.createObjectURL(currentPNGBlob);

    // SVG text
    currentSVGText = await window.QRCode.toString(text, { type: 'svg', margin, errorCorrectionLevel: ecc, ...(version>0?{version}:{}) });
    // Add watermark on SVG if free
    if (shouldWatermark()){
      currentSVGText = currentSVGText.replace('</svg>',
        `<text x="50%" y="98%" dominant-baseline="middle" text-anchor="middle" font-size="12" fill="#555" font-family="sans-serif">Generated with Connectivity QR (Free)</text></svg>`
      );
    }
    const svgBlob = new Blob([currentSVGText], {type:'image/svg+xml'});
    downloadSVG.href = URL.createObjectURL(svgBlob);

    currentQRData = text;
    qrStringEl.textContent = text;
    resultSection.classList.remove('hidden');
    nagMessage.textContent = isPro() ? '' : 'Watermark is removed in Pro.';

    // Update history
    pushHistory({ content: text, when: Date.now() });

    // Print quality indicator
    updatePrintIndicator({ px: qrCanvas.width, marginPx: margin, ecc });

    incrementRenderCount();
  }catch(e){
    console.error(e);
    showInfoToast('Failed to generate QR.');
  }
}

copyBtn.addEventListener('click', async ()=>{
  const text = qrStringEl.textContent || '';
  if (!text) return;
  try{ await navigator.clipboard.writeText(text); showInfoToast('String copied.'); }
  catch(err){ console.error(err); }
});

// ===== “Good for print” indicator (simple heuristic) =====
function updatePrintIndicator(stats){
  if (!stats){ printMsg.textContent='Awaiting preview…'; printDot.className='dot'; return; }
  const { px, marginPx, ecc } = stats;
  const good = (px>=512) && (marginPx>=8) && (ecc==='Q' || ecc==='H');
  printMsg.textContent = good ? 'Good for print' : 'Might be low quality for print';
  printDot.className = 'dot ' + (good?'ok':'warn');
}

// ===== History (local only) =====
function loadHistory(){
  try{ return JSON.parse(localStorage.getItem('qrHistory')||'[]'); } catch{ return []; }
}
function saveHistory(arr){ localStorage.setItem('qrHistory', JSON.stringify(arr.slice(-50))); }
function pushHistory(entry){ const h = loadHistory(); h.push(entry); saveHistory(h); renderHistory(); }
function renderHistory(){
  const h = loadHistory();
  const wrap = $('#historyList');
  wrap.innerHTML = '';
  if (!h.length){ wrap.innerHTML='<div class="section-tip">No items yet.</div>'; return; }
  h.slice(-10).reverse().forEach(it=>{
    const d = new Date(it.when||Date.now());
    const item = document.createElement('div');
    item.className='history-item';
    item.innerHTML = `<div class="mono small">${(it.content||'').slice(0,80)}</div><div class="muted small">${d.toLocaleString()}</div>`;
    item.addEventListener('click', ()=> {
      tabBtns.find(b=>b.dataset.tab==='builder').click();
      handleGenerate(it.content);
    });
    wrap.appendChild(item);
  });
}
$('#clearHistory').addEventListener('click', ()=>{ localStorage.removeItem('qrHistory'); renderHistory(); });

// ===== Batch (PNG+SVG ZIP, A4 PDF) =====
$('#runBatch').addEventListener('click', async ()=>{
  if (!isPro()) return showProToast('Batch ZIP is a Pro feature.');
  const file = $('#csvFile').files[0];
  if (!file) return showInfoToast('Pick a CSV file.');
  const text = await file.text();
  const rows = parseCSV(text);

  const ecc = $('#batchEcc').value || 'M';
  const size = Math.max(128, parseInt($('#batchSize').value,10)||512);
  const margin = Math.max(0, parseInt($('#batchMargin').value,10)||8);

  const zip = new window.JSZip();
  let idx=0;
  for (const r of rows){
    idx++;
    const lpa = buildLPA({
      presetId: r.matching ? 'lpa_3part' : 'lpa_2part',
      sdmp: r.smdp, match: r.matching, act: r.activation, conf: ''
    });
    const v = validateLPA(lpa);
    if (!v.ok) continue;

    // Canvas (PNG)
    const cv = document.createElement('canvas');
    await window.QRCode.toCanvas(cv, lpa, { width:size, margin, errorCorrectionLevel:ecc });

    let pngBlob = await new Promise(res=>cv.toBlob(res, 'image/png'));
    if (shouldWatermark()){
      // Paint watermark
      const tmp = document.createElement('canvas');
      tmp.width = cv.width; tmp.height = cv.height + 24 + margin;
      const tctx = tmp.getContext('2d');
      tctx.fillStyle = '#fff';
      tctx.fillRect(0,0,tmp.width,tmp.height);
      tctx.drawImage(cv,0,0);
      tctx.fillStyle = '#555';
      tctx.font = '14px ui-sans-serif, system-ui';
      tctx.textAlign = 'center';
      tctx.fillText('Generated with Connectivity QR (Free)', tmp.width/2, cv.height + 16);
      pngBlob = await new Promise(res=>tmp.toBlob(res,'image/png'));
    }
    const baseName = (r.label||`item_${idx}`).replace(/[^\w\-]+/g,'_');
    zip.file(`${baseName}.png`, pngBlob);

    // SVG
    let svgText = await window.QRCode.toString(lpa, { type:'svg', margin, errorCorrectionLevel:ecc });
    if (shouldWatermark()){
      svgText = svgText.replace('</svg>',
        `<text x="50%" y="98%" dominant-baseline="middle" text-anchor="middle" font-size="12" fill="#555" font-family="sans-serif">Generated with Connectivity QR (Free)</text></svg>`
      );
    }
    zip.file(`${baseName}.svg`, svgText);
  }
  const blob = await zip.generateAsync({type:'blob'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'qr_batch.zip';
  a.click();
  showInfoToast('ZIP ready.');
});

$('#runBatchPDF').addEventListener('click', async ()=>{
  if (!isPro()) return showProToast('PDF A4 Sheet is a Pro feature.');
  const file = $('#csvFile').files[0];
  if (!file) return showInfoToast('Pick a CSV file.');
  const text = await file.text();
  const rows = parseCSV(text);

  // Build minimal tiles with data URLs to speed up
  const ecc = $('#batchEcc').value || 'M';
  const size = 512; // internal render for quality
  const margin = 8;

  const tiles = [];
  for (const r of rows){
    const lpa = buildLPA({
      presetId: r.matching ? 'lpa_3part' : 'lpa_2part',
      sdmp: r.smdp, match: r.matching, act: r.activation, conf: ''
    });
    const v = validateLPA(lpa); if (!v.ok) continue;
    const cv = document.createElement('canvas');
    await window.QRCode.toCanvas(cv, lpa, { width:size, margin, errorCorrectionLevel:ecc, color:{dark:'#000',light:'#fff'} });
    const url = cv.toDataURL('image/png');
    tiles.push({ url, label: r.label||'' });
  }
  const pdfBlob = await buildA4PDF({ tiles });
  if (!pdfBlob) return;

  const a = document.createElement('a');
  a.href = URL.createObjectURL(pdfBlob);
  a.download = 'qr_sheet.pdf';
  a.click();
});

// ===== Export / Sheet Maker from current QR =====
$('#makeSheetFromCurrent').addEventListener('click', async ()=>{
  if (!currentPNGBlob) return showInfoToast('Generate a QR first.');
  const imgUrl = URL.createObjectURL(currentPNGBlob);
  const tiles = Array(getGridCount()).fill(0).map(()=>({ url: imgUrl, label: $('#labelText').value||'' }));
  const logo = await readLogoFile();
  const pdfBlob = await buildA4PDF({ tiles, logo });
  if (!pdfBlob) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(pdfBlob);
  a.download = 'qr_sheet.pdf';
  a.click();
});

$('#previewPDF').addEventListener('click', async ()=>{
  if (!currentPNGBlob) return showInfoToast('Generate a QR first.');
  const imgUrl = URL.createObjectURL(currentPNGBlob);
  const tiles = Array(getGridCount()).fill(0).map(()=>({ url: imgUrl, label: $('#labelText').value||'' }));
  const logo = await readLogoFile();
  const blob = await buildA4PDF({ tiles, logo });
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  $('#pdfPreviewWrap').hidden = false;
  $('#pdfPreviewFrame').src = url;
});

// Helpers for PDF sheet
function getGridPreset(){
  const preset = $('#sheetPreset').value;
  if (preset==='3x4') return { cols:3, rows:4 };
  if (preset==='4x5') return { cols:4, rows:5 };
  if (preset==='5x7') return { cols:5, rows:7 };
  return {
    cols: Math.max(1, parseInt($('#cols').value,10)||3),
    rows: Math.max(1, parseInt($('#rows').value,10)||4),
  };
}
function getGridCount(){ const {cols,rows}=getGridPreset(); return cols*rows; }
async function readLogoFile(){
  const f = $('#logoFile').files[0];
  if (!f) return null;
  const buf = await f.arrayBuffer();
  const blob = new Blob([buf], {type:f.type||'image/png'});
  return URL.createObjectURL(blob);
}

async function buildA4PDF({ tiles, logo=null }){
  try{
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit:'mm', format:'a4' });
    const W=210, H=297;
    const margin = Math.max(0, parseFloat($('#marginMM').value)||10);
    const gap = Math.max(0, parseFloat($('#gapMM').value)||4);
    const { cols, rows } = getGridPreset();

    const cellW = (W - margin*2 - gap*(cols-1)) / cols;
    const cellH = (H - margin*2 - gap*(rows-1)) / rows;

    const labelText = $('#labelText').value||'';

    let idx=0;
    for (let r=0; r<rows; r++){
      for (let c=0; c<cols; c++){
        const x = margin + c*(cellW+gap);
        const y = margin + r*(cellH+gap);
        // QR square area (keep square inside the cell; leave 8mm for label)
        const qrH = Math.min(cellW, cellH - (labelText?8:0));
        const tile = tiles[idx % tiles.length];
        // QR
        doc.addImage(tile.url, 'PNG', x, y, qrH, qrH);
        // Center logo overlay (optional)
        if (logo){
          const lx = x + qrH*0.35;
          const ly = y + qrH*0.35;
          const ls = qrH*0.30;
          doc.addImage(logo, 'PNG', lx, ly, ls, ls);
        }
        // Label
        if (labelText){
          doc.setFont('helvetica','normal');
          doc.setFontSize(9);
          doc.text(labelText, x + qrH/2, y + qrH + 5.5, { align:'center', baseline:'middle' });
        }
        idx++;
      }
    }
    const blob = doc.output('blob');
    return blob;
  }catch(err){
    console.error(err);
    showInfoToast('Failed to build PDF.');
    return null;
  }
}

// ===== Validate / Decode =====
$('#btnValidate').addEventListener('click', ()=>{
  const s = $('#valInput').value.trim();
  doValidateString(s);
});
$('#decodeFile').addEventListener('change', async (e)=>{
  const f = e.target.files[0];
  if (!f) return;
  try{
    const imgURL = URL.createObjectURL(f);
    // Try BarcodeDetector (Chromium). Firefox may not support.
    if ('BarcodeDetector' in window){
      const det = new window.BarcodeDetector({ formats: ['qr_code'] });
      const img = new Image();
      await new Promise(res=>{ img.onload=res; img.src=imgURL; });
      const canvas = document.createElement('canvas');
      canvas.width = img.width; canvas.height = img.height;
      canvas.getContext('2d').drawImage(img,0,0);
      const results = await det.detect(canvas);
      if (results && results[0] && results[0].rawValue){
        doValidateString(results[0].rawValue);
        return;
      }
    }
    showInfoToast('QR decoding not supported in this browser.');
  }catch(err){
    console.error(err); showInfoToast('Decode failed.');
  }
});
function doValidateString(s){
  const badge = $('#valStatus');
  const details = $('#valDetails');
  details.textContent='';
  if (!s){ badge.className='badge'; badge.textContent='—'; return; }

  if (/^LPA:1\$/i.test(s)){
    const v = validateLPA(s);
    if (v.ok){
      badge.className='badge ok'; badge.textContent='OK';
      const p = v.parts;
      details.innerHTML = `
        <div><strong>SM-DP+:</strong> ${p.smdp}</div>
        ${p.matching?`<div><strong>Matching:</strong> ${p.matching}</div>`:''}
        <div><strong>Activation:</strong> ${p.activation}</div>
        ${p.confirmation?`<div><strong>Confirmation:</strong> ${p.confirmation}</div>`:''}
        <div class="muted small">${v.format === '3part' ? '3-part LPA' : '2-part LPA'}</div>
      `;
    } else {
      badge.className='badge err'; badge.textContent='ERROR';
      details.textContent = v.reason||'Invalid LPA';
    }
    return;
  }

  if (/^WIFI:/i.test(s)){
    const w = parseWiFi(s);
    if (w){
      badge.className='badge ok'; badge.textContent='OK';
      details.innerHTML = `
        <div><strong>Type:</strong> ${w.T}</div>
        <div><strong>SSID:</strong> ${w.S}</div>
        <div><strong>Password:</strong> ${w.P? '••••••' : '(none)'}</div>
        <div><strong>Hidden:</strong> ${w.H||'false'}</div>
      `;
      return;
    }
  }

  badge.className='badge err'; badge.textContent='UNKNOWN';
  details.textContent = 'Unsupported string format.';
}

// ===== Mode switch =====
$$('input[name="mode"]').forEach(r=>{
  r.addEventListener('change', (e)=>{ mode = e.target.value; renderCustomBuilder(); });
});

// ===== Presets load =====
async function init(){
  const plan = getPlan();
  if (planBadge) planBadge.textContent = plan.name.toUpperCase();

  await loadPresets();
  renderPresets();
  renderCustomBuilder();
  renderHistory();
  tset();

  if ('serviceWorker' in navigator){
    try{ await navigator.serviceWorker.register('./sw.js'); }
    catch(err){ console.warn('Service worker registration failed', err); }
  }
}
init();
