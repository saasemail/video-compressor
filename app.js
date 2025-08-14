// app.js — Connectivity QR Toolkit (offline)
// Needs window.QRCode, window.jspdf.jsPDF, window.JSZip + ZXing WASM

import {
  getPlan, canRender, incrementRenderCount,
  shouldWatermark, getDelay, isPro, getBatchLimit, isPdfWatermarked
} from './licensing.js';

const $  = (s, r=document)=>r.querySelector(s);
const $$ = (s, r=document)=>Array.from(r.querySelectorAll(s));

/* Modal helpers */
function openLearnModal(){ const d=$('#learnModal'); if(d && !d.open) d.showModal(); }
function closeLearnModal(){ const d=$('#learnModal'); if(d && d.open) d.close(); }
window.openLearnModal=openLearnModal; window.closeLearnModal=closeLearnModal;

/* Toasts */
function showProToast(msg='This feature is available in Pro.'){
  const t=$('#proToast'); if(!t) return;
  $('#proToastMsg').textContent=' '+msg+' '; t.classList.remove('hidden');
  clearTimeout(window.__proToastTimer); window.__proToastTimer=setTimeout(hideProToast,2200);
}
function showInfoToast(msg=''){ const t=$('#proToast'); if(!t) return;
  const strong=t.querySelector('.toast-text strong'), icon=t.querySelector('.toast-icon');
  if (icon) icon.style.display='none'; if (strong) strong.style.display='none';
  $('#proToastMsg').textContent=' '+msg+' '; t.classList.remove('hidden');
  clearTimeout(window.__proToastTimer); window.__proToastTimer=setTimeout(hideProToast,2400);
}
function hideProToast(){ const t=$('#proToast'); if(t) t.classList.add('hidden'); clearTimeout(window.__proToastTimer); }
window.hideProToast=hideProToast;

/* i18n */
const i18n={ en:{heroSubtitle:'Offline, privacy-first. Build, validate, and print eSIM/Wi-Fi QR codes — no uploads.', heroHint:'Free adds a watermark · Pro removes watermark and unlocks Batch/PDF'},
             sr:{heroSubtitle:'Offline i privatno. Kreiraj, proveri i odštampaj eSIM/Wi-Fi QR kodove — bez slanja podataka.', heroHint:'Free dodaje watermark · Pro uklanja watermark i otključava Batch/PDF'} };
let lang='en';
function tset(){ $('[data-i18n="heroSubtitle"]').textContent=i18n[lang].heroSubtitle; $('[data-i18n="heroHint"]').textContent=i18n[lang].heroHint; }
$('#langToggle').addEventListener('click',()=>{ lang=(lang==='en'?'sr':'en'); $('#langToggle').textContent=(lang==='en'?'SR':'EN'); $('#langToggle').setAttribute('aria-pressed', lang==='sr'?'true':'false'); tset(); });

/* Views */
function showView(view){
  // sakrij sve
  $$('#view-esim, #view-wifi, #view-sheets').forEach(v=>v.classList.add('hidden'));
  // prikaži izabrani
  $(`#view-${view}`).classList.remove('hidden');
  // plan badge
  $('#planBadge').textContent=getPlan().name.toUpperCase();

  if (view==='esim'){
    // render eSIM builder
    mode='esim'; renderCustomBuilder(); renderFeatureMatrix();
    $('#startNow').onclick=()=>$('#view-esim').scrollIntoView({behavior:'smooth', block:'start'});
  }
  if (view==='wifi'){
    // render Wi-Fi builder
    renderWifiBuilder(); renderFeatureMatrix();
    $('#startNow').onclick=()=>$('#view-wifi').scrollIntoView({behavior:'smooth', block:'start'});
  }
  if (view==='sheets'){
    renderFeatureMatrix();
    $('#startNow').onclick=()=>$('#view-sheets').scrollIntoView({behavior:'smooth', block:'start'});
  }
}

/* Tool cards */
$('#toolEsim').addEventListener('click', ()=>showView('esim'));
$('#toolWifi').addEventListener('click', ()=>showView('wifi'));
$('#toolSheets').addEventListener('click', ()=>showView('sheets'));
$('#startNow').addEventListener('click', ()=>showView('esim'));

/* State / elements (eSIM) */
let presets=[]; let selectedPresetId=null; let mode='esim';
const progressSection=$('#progressSection'); const progressBar=$('#progressBar'); const progressLabel=$('#progressLabel');
const resultSection=$('#resultSection'); const qrCanvas=$('#qrCanvas'); const qrStringEl=$('#qrString');
const downloadPNG=$('#downloadPNG'); const downloadSVG=$('#downloadSVG'); const copyBtn=$('#copyBtn'); const nagMessage=$('#nagMessage');
const printDot=$('#printDot'); const printMsg=$('#printMsg');

/* Load presets */
async function loadPresets(){ const resp=await fetch('./presets.json'); presets=await resp.json(); }
function createPresetCard(preset){
  const card=document.createElement('div'); card.className='preset-card'; card.dataset.presetId=preset.id;
  const header=document.createElement('div'); header.className='preset-header';
  header.innerHTML=`<div class="preset-title">${preset.label}</div><div class="preset-category">${preset.category}</div>`;
  card.appendChild(header);
  if (preset.hint){ const hintEl=document.createElement('div'); hintEl.className='preset-hint'; hintEl.textContent=preset.hint; card.appendChild(hintEl); }
  card.addEventListener('click', ()=>{ selectedPresetId=preset.id; $$('.preset-card.selected').forEach(el=>el.classList.remove('selected')); card.classList.add('selected'); renderCustomBuilder(); });
  return card;
}
function renderPresets(){
  const top=$('#topPresets'), other=$('#otherPresets'); if(!top||!other) return;
  top.innerHTML=''; other.innerHTML='';
  const topIds=['lpa_2part']; const byId=new Map(presets.map(p=>[p.id,p]));
  topIds.forEach(id=>{ const p=byId.get(id); if(p) top.appendChild(createPresetCard(p)); });
  presets.filter(p=>!topIds.includes(p.id)).forEach(p=>other.appendChild(createPresetCard(p)));
  const first=$('.preset-card'); if(first) first.click();
}

/* Helpers LPA/Wi-Fi */
function buildLPA({ presetId, sdmp, match, act, conf }){
  const parts=['LPA:1']; if(sdmp) parts.push(sdmp.trim());
  if (presetId==='lpa_3part'){ if(match) parts.push(match.trim()); if(act) parts.push(act.trim()); }
  else { if(act) parts.push(act.trim()); }
  if (conf) parts.push(conf.trim());
  return parts.join('$');
}
function validateLPA(str){
  if(!/^LPA:1\$/i.test(str)) return { ok:false, reason:'Must start with LPA:1$' };
  const parts=str.split('$'); if(parts.length<3) return { ok:false, reason:'Missing fields' };
  const smdp=parts[1]||''; if(!/^[A-Za-z0-9.\-+_:]+$/.test(smdp)) return { ok:false, reason:'Invalid SM-DP+ address' };
  let matching='', activation='', confirmation='';
  if(parts.length>=4){ if(parts[2]&&parts[3]){ matching=parts[2]; activation=parts[3]; if(parts.length>=5) confirmation=parts[4]; }
    else { activation=parts[2]; confirmation=parts[3]||''; } }
  else activation=parts[2];
  if(!/^[A-Za-z0-9\-._]+$/.test(activation)) return { ok:false, reason:'Invalid Activation Code' };
  if(confirmation && !/^[A-Za-z0-9\-._]+$/.test(confirmation)) return { ok:false, reason:'Invalid Confirmation Code' };
  return { ok:true, parts:{smdp, matching, activation, confirmation}, format: matching?'3part':'2part' };
}
function parseWiFi(str){ if(!/^WIFI:/i.test(str)) return null; const out={T:'',S:'',P:'',H:''};
  str.replace(/^WIFI:/i,'').split(';').forEach(kv=>{ const [k,v='']=kv.split(':'); if(k&&k in out) out[k]=v; });
  return out;
}
function buildWiFi({ ssid, security, pass, hidden }){
  const T=(security||'WPA').toUpperCase(); const S=ssid||''; const P=pass||''; const H=hidden?'true':'false';
  return `WIFI:T:${T};S:${escapeWiFi(S)};P:${escapeWiFi(P)};H:${H};;`;
}
function escapeWiFi(s){ return (s||'').replace(/([;,:\\"])/g,'\\$1'); }

/* CSV */
function parseCSV(text){
  const rows=[]; let i=0, cell='', row=[], inQ=false;
  while(i<text.length){ const c=text[i++];
    if(inQ){ if(c===`"`){ if(text[i]==='"'){ cell+=`"`; i++; } else inQ=false; } else cell+=c; }
    else { if(c===`,`) { row.push(cell); cell=''; }
           else if(c===`\n`) { row.push(cell); rows.push(row); row=[]; cell=''; }
           else if(c===`\r`) { }
           else if(c===`"`) { inQ=true; }
           else cell+=c; } }
  row.push(cell); rows.push(row);
  const header=rows.shift().map(h=>h.trim().toLowerCase());
  return rows.filter(r=>r.some(x=>x.trim()!=='')).map(r=>{ const obj={}; header.forEach((h,idx)=>obj[h]=(r[idx]||'').trim()); return obj; });
}

/* eSIM Builder (shared panel) */
function renderCustomBuilder(){
  const p = presets.find(x=>x.id===selectedPresetId) || presets[0];
  const cp=$('#customPanel'); if(!cp) return;

  cp.innerHTML=`
    <div><label for="sdmp">SM-DP+ address</label><input id="sdmp" placeholder="smdp.example.com" autocomplete="off"/></div>
    ${p.id==='lpa_3part' ? `<div><label for="match">Matching ID</label><input id="match" placeholder="(optional)" autocomplete="off"/></div>` : `<input id="match" type="hidden" />`}
    <div><label for="act">Activation code</label><input id="act" placeholder="1234-5678-90AB-CDEF" autocomplete="off"/></div>
    <div><label for="conf">Confirmation code (optional)</label><input id="conf" placeholder="" autocomplete="off"/></div>
    <div style="grid-column:1/-1"><label for="raw">Raw string (editable)</label><textarea id="raw" rows="3" class="mono" placeholder="LPA:1$..."></textarea></div>
    <div class="row" style="grid-column:1/-1"><button id="btnGen" class="btn btn-primary">Generate QR</button><button id="btnClear" class="btn btn-secondary" type="button">Clear</button></div>`;

  const sdmp=$('#sdmp'), match=$('#match'), act=$('#act'), conf=$('#conf'), raw=$('#raw');
  function syncRaw(){ raw.value = buildLPA({ presetId:p.id, sdmp:sdmp?.value||'', match:match?.value||'', act:act?.value||'', conf:conf?.value||'' }); }
  [sdmp, match, act, conf].forEach(inp=>inp && inp.addEventListener('input', syncRaw));
  syncRaw();

  $('#btnClear')?.addEventListener('click', ()=>{ [sdmp, match, act, conf].forEach(inp=>inp && (inp.value='')); syncRaw(); resultSection.classList.add('hidden'); downloadPNG.removeAttribute('href'); downloadSVG.removeAttribute('href'); qrStringEl.textContent=''; updatePrintIndicator(null); });
  $('#btnGen')?.addEventListener('click', ()=> handleGenerate(raw.value));
}

/* Wi-Fi Builder (separate small UI) */
function renderWifiBuilder(){
  const mount=$('#wifiPanelMount'); if(!mount) return;
  mount.innerHTML=`
    <div><label for="ssid">SSID</label><input id="ssid" placeholder="Network name" autocomplete="off"/></div>
    <div><label for="sec">Security</label><select id="sec"><option value="WPA">WPA/WPA2</option><option value="WPA3">WPA3</option><option value="nopass">No password</option></select></div>
    <div><label for="wpass">Password</label><input id="wpass" placeholder="" autocomplete="off"/></div>
    <div><label for="hidden">Hidden</label><select id="hidden"><option value="false">No</option><option value="true">Yes</option></select></div>
    <div style="grid-column:1/-1"><label for="rawW">Raw string (editable)</label><textarea id="rawW" rows="3" class="mono" placeholder="WIFI:T:..."></textarea></div>
    <div class="row" style="grid-column:1/-1"><button id="btnGenW" class="btn btn-primary">Generate QR</button><button id="btnClearW" class="btn btn-secondary" type="button">Clear</button></div>`;

  const ssid=$('#ssid'), sec=$('#sec'), wpass=$('#wpass'), hidden=$('#hidden'), raw=$('#rawW');
  function syncRaw(){ raw.value = buildWiFi({ ssid:ssid?.value||'', security:(sec?.value||'WPA'), pass:(sec?.value==='nopass'?'':(wpass?.value||'')), hidden:(hidden?.value==='true') }); }
  ;[ssid,sec,wpass,hidden].forEach(i=>i && i.addEventListener('input', syncRaw));
  syncRaw();

  $('#btnClearW')?.addEventListener('click', ()=>{ [ssid,sec,wpass,hidden].forEach(i=>{ if(i.tagName==='SELECT') i.selectedIndex=0; else i.value=''; }); syncRaw(); $('#resultSectionW').classList.add('hidden'); $('#downloadPNGW').removeAttribute('href'); $('#downloadSVGW').removeAttribute('href'); $('#qrStringW').textContent=''; });

  $('#btnGenW')?.addEventListener('click', async ()=>{
    const ecc=$('#ecc-w').value||'M'; const px=Math.max(128, parseInt($('#qrsize-w').value,10)||512); const margin=Math.max(0, parseInt($('#qrmarg-w').value,10)||8);
    const text=raw.value.trim();

    const canvas=$('#qrCanvasW'); const ctx=canvas.getContext('2d'); ctx.clearRect(0,0,canvas.width,canvas.height);
    await window.QRCode.toCanvas(canvas, text, { width:px, margin, errorCorrectionLevel:ecc, color:{dark:'#000',light:'#FFF'} });

    if (shouldWatermark()){
      const h=22; const tmp=document.createElement('canvas'); tmp.width=canvas.width; tmp.height=canvas.height+h+margin;
      const t=tmp.getContext('2d'); t.fillStyle='#fff'; t.fillRect(0,0,tmp.width,tmp.height); t.drawImage(canvas,0,0);
      t.fillStyle='#555'; t.font='14px ui-sans-serif, system-ui'; t.textAlign='center'; t.fillText('Generated with Connectivity QR (Free)', tmp.width/2, canvas.height+16);
      canvas.width=tmp.width; canvas.height=tmp.height; canvas.getContext('2d').drawImage(tmp,0,0);
    }

    const png=await new Promise(res=>canvas.toBlob(res,'image/png')); $('#downloadPNGW').href=URL.createObjectURL(png);
    let svg=await window.QRCode.toString(text,{type:'svg',margin,errorCorrectionLevel:ecc}); if(shouldWatermark()){ svg=svg.replace('</svg>', `<text x="50%" y="98%" dominant-baseline="middle" text-anchor="middle" font-size="12" fill="#555" font-family="sans-serif">Generated with Connectivity QR (Free)</text></svg>`); }
    $('#downloadSVGW').href=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));

    $('#qrStringW').textContent=text; $('#resultSectionW').classList.remove('hidden'); $('#nagMessageW').textContent = isPro() ? '' : 'Watermark is removed in Pro.';
  });

  $('#copyBtnW')?.addEventListener('click', async ()=>{ const s=$('#qrStringW').textContent||''; if(!s) return; try{ await navigator.clipboard.writeText(s); showInfoToast('String copied.'); }catch(e){} });
}

/* Generate eSIM QR */
async function handleGenerate(text){
  $('#planBadge').textContent = getPlan().name.toUpperCase();
  const permission=canRender(0); if(!permission.allowed){ showInfoToast(permission.reason); return; }

  const ecc=$('#ecc').value||'M'; const version=parseInt($('#version').value,10)||0;
  const px=Math.max(128, parseInt($('#qrsize').value,10)||512);
  const margin=Math.max(0, parseInt($('#qrmarg').value,10)||8);

  if (/^LPA:1\$/i.test(text)){ const v=validateLPA(text); const status=v.ok?'OK':('Error: '+v.reason); showInfoToast('LPA check: '+status); if(!v.ok) return; }

  const delay=getDelay();
  if(delay>0){
    progressSection.classList.remove('hidden'); progressBar.style.width='0%';
    const start=Date.now(), end=start+delay;
    const tick=()=>{ const left=Math.max(0,end-Date.now()); const s=Math.ceil(left/1000); progressLabel.textContent=`Preparing… ${s}s`; const pct=Math.round(100*(1-left/delay)); progressBar.style.width=`${pct}%`; if(left>0) requestAnimationFrame(tick); };
    tick(); await new Promise(res=>setTimeout(res, delay)); progressSection.classList.add('hidden');
  }

  const ctx=qrCanvas.getContext('2d'); ctx.clearRect(0,0,qrCanvas.width,qrCanvas.height);
  try{
    await window.QRCode.toCanvas(qrCanvas, text, { width:px, margin, errorCorrectionLevel:ecc, ...(version>0?{version}:{}) , color:{dark:'#000', light:'#FFF'} });

    if (shouldWatermark()){
      const h=22; const tmp=document.createElement('canvas'); tmp.width=qrCanvas.width; tmp.height=qrCanvas.height+h+margin;
      const tctx=tmp.getContext('2d'); tctx.fillStyle='#fff'; tctx.fillRect(0,0,tmp.width,tmp.height); tctx.drawImage(qrCanvas,0,0);
      tctx.fillStyle='#555'; tctx.font='14px ui-sans-serif, system-ui'; tctx.textAlign='center'; tctx.fillText('Generated with Connectivity QR (Free)', tmp.width/2, qrCanvas.height+16);
      qrCanvas.width=tmp.width; qrCanvas.height=tmp.height; qrCanvas.getContext('2d').drawImage(tmp,0,0);
    }

    const pngBlob = await new Promise(res=>qrCanvas.toBlob(res,'image/png')); downloadPNG.href = URL.createObjectURL(pngBlob);
    let svgText = await window.QRCode.toString(text, { type:'svg', margin, errorCorrectionLevel:ecc, ...(version>0?{version}:{}) });
    if (shouldWatermark()){ svgText = svgText.replace('</svg>', `<text x="50%" y="98%" dominant-baseline="middle" text-anchor="middle" font-size="12" fill="#555" font-family="sans-serif">Generated with Connectivity QR (Free)</text></svg>`); }
    downloadSVG.href = URL.createObjectURL(new Blob([svgText], {type:'image/svg+xml'}));

    qrStringEl.textContent=text; resultSection.classList.remove('hidden');
    nagMessage.textContent = isPro() ? '' : 'Watermark is removed in Pro.';

    pushHistory({ content:text, when:Date.now() });
    updatePrintIndicator({ px:qrCanvas.width, marginPx:margin, ecc });
    incrementRenderCount();
  }catch(e){ console.error(e); showInfoToast('Failed to generate QR.'); }
}
copyBtn?.addEventListener('click', async ()=>{ const text=qrStringEl.textContent||''; if(!text) return; try{ await navigator.clipboard.writeText(text); showInfoToast('String copied.'); }catch(e){} });

function updatePrintIndicator(stats){ if(!stats){ printMsg.textContent='Awaiting preview…'; printDot.className='dot'; return; }
  const { px, marginPx, ecc }=stats; const good=(px>=512)&&(marginPx>=8)&&(ecc==='Q'||ecc==='H'); printMsg.textContent=good?'Good for print':'Might be low quality for print'; printDot.className='dot '+(good?'ok':'warn'); }

/* History */
function loadHistory(){ try{ return JSON.parse(localStorage.getItem('qrHistory')||'[]'); }catch{ return []; } }
function saveHistory(arr){ localStorage.setItem('qrHistory', JSON.stringify(arr.slice(-50))); }
function pushHistory(e){ const h=loadHistory(); h.push(e); saveHistory(h); renderHistory(); }
function renderHistory(){
  const h=loadHistory(); const wrap=$('#historyList'); if(!wrap) return;
  wrap.innerHTML=''; if(!h.length){ wrap.innerHTML='<div class="section-tip">No items yet.</div>'; return; }
  h.slice(-10).reverse().forEach(it=>{ const d=new Date(it.when||Date.now()); const item=document.createElement('div'); item.className='history-item';
    item.innerHTML=`<div class="mono small">${(it.content||'').slice(0,80)}</div><div class="muted small">${d.toLocaleString()}</div>`;
    item.addEventListener('click', ()=>{ handleGenerate(it.content); });
    wrap.appendChild(item);
  });
}
$('#clearHistory')?.addEventListener('click', ()=>{ localStorage.removeItem('qrHistory'); renderHistory(); });

/* Batch ZIP & PDF */
$('#runBatch')?.addEventListener('click', async ()=>{
  const file=$('#csvFile').files[0]; if(!file) return showInfoToast('Pick a CSV file.');
  const text=await file.text(); let rows=parseCSV(text);
  const limit=getBatchLimit(); if(limit){ rows=rows.slice(0,limit); showInfoToast(`Demo: processed first ${limit} row`); }
  const ecc=$('#batchEcc').value||'M'; const size=Math.max(128,parseInt($('#batchSize').value,10)||512); const margin=Math.max(0,parseInt($('#batchMargin').value,10)||8);
  const zip=new window.JSZip(); let idx=0;
  for (const r of rows){
    idx++;
    const lpa=buildLPA({ presetId: r.matching ? 'lpa_3part':'lpa_2part', sdmp:r.smdp, match:r.matching, act:r.activation, conf:'' });
    const v=validateLPA(lpa); if(!v.ok) continue;
    const cv=document.createElement('canvas'); await window.QRCode.toCanvas(cv,lpa,{width:size,margin,errorCorrectionLevel:ecc});
    let pngBlob=await new Promise(res=>cv.toBlob(res,'image/png'));
    if(shouldWatermark()){
      const tmp=document.createElement('canvas'); tmp.width=cv.width; tmp.height=cv.height+24+margin;
      const t=tmp.getContext('2d'); t.fillStyle='#fff'; t.fillRect(0,0,tmp.width,tmp.height); t.drawImage(cv,0,0);
      t.fillStyle='#555'; t.font='14px ui-sans-serif, system-ui'; t.textAlign='center'; t.fillText('Generated with Connectivity QR (Free)', tmp.width/2, cv.height+16);
      pngBlob=await new Promise(res=>tmp.toBlob(res,'image/png'));
    }
    const base=(r.label||`item_${idx}`).replace(/[^\w\-]+/g,'_'); zip.file(`${base}.png`, pngBlob);
    let svg=await window.QRCode.toString(lpa,{type:'svg',margin,errorCorrectionLevel:ecc}); if(shouldWatermark()){ svg=svg.replace('</svg>', `<text x="50%" y="98%" dominant-baseline="middle" text-anchor="middle" font-size="12" fill="#555" font-family="sans-serif">Generated with Connectivity QR (Free)</text></svg>`); }
    zip.file(`${base}.svg`, svg);
  }
  const blob=await zip.generateAsync({type:'blob'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='qr_batch.zip'; a.click(); showInfoToast('ZIP ready.');
});

$('#runBatchPDF')?.addEventListener('click', async ()=>{
  const file=$('#csvFile').files[0]; if(!file) return showInfoToast('Pick a CSV file.');
  const text=await file.text(); let rows=parseCSV(text);
  const limit=getBatchLimit(); if(limit){ rows=rows.slice(0,limit); showInfoToast(`Demo: processed first ${limit} row`); }
  const ecc=$('#batchEcc').value||'M'; const size=512; const margin=8;
  const tiles=[];
  for(const r of rows){
    const lpa=buildLPA({ presetId:r.matching?'lpa_3part':'lpa_2part', sdmp:r.smdp, match:r.matching, act:r.activation, conf:'' });
    const v=validateLPA(lpa); if(!v.ok) continue;
    const cv=document.createElement('canvas'); await window.QRCode.toCanvas(cv,lpa,{width:size,margin,errorCorrectionLevel:ecc,color:{dark:'#000',light:'#fff'}});
    tiles.push({ url:cv.toDataURL('image/png'), label:r.label||'' });
  }
  const pdfBlob=await buildA4PDF({ tiles }); if(!pdfBlob) return;
  const a=document.createElement('a'); a.href=URL.createObjectURL(pdfBlob); a.download='qr_sheet.pdf'; a.click();
});

/* Sheets (from current QR) */
$('#makeSheetFromCurrent')?.addEventListener('click', async ()=>{
  const imgUrl = await ensureCurrentQRUrl(); if(!imgUrl) return showInfoToast('Generate a QR first (eSIM or Wi-Fi).');
  const tiles=Array(getGridCount()).fill(0).map(()=>({url:imgUrl,label:$('#labelText').value||''}));
  const logo=await readLogoFile(); const pdfBlob=await buildA4PDF({ tiles, logo }); if(!pdfBlob) return;
  const a=document.createElement('a'); a.href=URL.createObjectURL(pdfBlob); a.download='qr_sheet.pdf'; a.click();
});
$('#previewPDF')?.addEventListener('click', async ()=>{
  const imgUrl = await ensureCurrentQRUrl(); if(!imgUrl) return showInfoToast('Generate a QR first (eSIM or Wi-Fi).');
  const tiles=Array(getGridCount()).fill(0).map(()=>({url:imgUrl,label:$('#labelText').value||''}));
  const logo=await readLogoFile(); const blob=await buildA4PDF({ tiles, logo }); if(!blob) return;
  const url=URL.createObjectURL(blob); $('#pdfPreviewWrap').hidden=false; $('#pdfPreviewFrame').src=url;
});
async function ensureCurrentQRUrl(){
  // Prefer eSIM canvas if visible, else Wi-Fi
  if ($('#qrCanvas') && !$('#resultSection')?.classList.contains('hidden')){
    return await new Promise(res=>$('#qrCanvas').toBlob(b=>res(URL.createObjectURL(b)),'image/png'));
  }
  if ($('#qrCanvasW') && !$('#resultSectionW')?.classList.contains('hidden')){
    return await new Promise(res=>$('#qrCanvasW').toBlob(b=>res(URL.createObjectURL(b)),'image/png'));
  }
  return null;
}
function getGridPreset(){ const preset=$('#sheetPreset').value;
  if(preset==='3x4') return {cols:3,rows:4}; if(preset==='4x5') return {cols:4,rows:5}; if(preset==='5x7') return {cols:5,rows:7};
  return { cols:Math.max(1,parseInt($('#cols').value,10)||3), rows:Math.max(1,parseInt($('#rows').value,10)||4) };
}
function getGridCount(){ const {cols,rows}=getGridPreset(); return cols*rows; }
async function readLogoFile(){ const f=$('#logoFile').files[0]; if(!f) return null; const buf=await f.arrayBuffer(); return URL.createObjectURL(new Blob([buf],{type:f.type||'image/png'})); }
async function buildA4PDF({ tiles, logo=null }){
  try{
    const { jsPDF }=window.jspdf; const doc=new jsPDF({ unit:'mm', format:'a4' });
    const W=210, H=297; const margin=Math.max(0, parseFloat($('#marginMM').value)||10); const gap=Math.max(0, parseFloat($('#gapMM').value)||4);
    const { cols, rows }=getGridPreset(); const cellW=(W - margin*2 - gap*(cols-1)) / cols; const cellH=(H - margin*2 - gap*(rows-1)) / rows;
    const labelText=$('#labelText').value||''; let idx=0;
    for(let r=0;r<rows;r++){ for(let c=0;c<cols;c++){ const x=margin+c*(cellW+gap); const y=margin+r*(cellH+gap);
        const qrH=Math.min(cellW, cellH - (labelText?8:0)); const tile=tiles[idx % tiles.length];
        doc.addImage(tile.url,'PNG',x,y,qrH,qrH);
        if(logo){ const lx=x+qrH*0.35, ly=y+qrH*0.35, ls=qrH*0.30; doc.addImage(logo,'PNG',lx,ly,ls,ls); }
        if(labelText){ doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.text(labelText, x+qrH/2, y+qrH+5.5, {align:'center', baseline:'middle'}); }
        idx++;
    }}
    if (isPdfWatermarked()){
      // diskretan veliki watermark
      doc.setTextColor(150,150,150); doc.setFontSize(40); doc.setGState(doc.GState({opacity:0.18}));
      doc.saveGraphicsState(); doc.rotate(-30, {origin:[105,148]});
      doc.text('Connectivity QR — Free', 40, 160); doc.restoreGraphicsState();
    }
    return doc.output('blob');
  }catch(err){ console.error(err); showInfoToast('Failed to build PDF.'); return null; }
}

/* Validate / Decode (shared + Wi-Fi view) */
$('#btnValidate')?.addEventListener('click', ()=>{ const s=$('#valInput').value.trim(); doValidateString(s, 'main'); });
$('#btnValidateW')?.addEventListener('click', ()=>{ const s=$('#valInputW').value.trim(); doValidateString(s, 'wifi'); });

$('#decodeFile')?.addEventListener('change', async (e)=>{ const f=e.target.files[0]; if(!f) return; const imgURL=URL.createObjectURL(f); const text=await decodeImageToText(imgURL); if(text){ doValidateString(text,'main'); } else showInfoToast('No QR found.'); });
$('#decodeFileW')?.addEventListener('change', async (e)=>{ const f=e.target.files[0]; if(!f) return; const imgURL=URL.createObjectURL(f); const text=await decodeImageToText(imgURL); if(text){ doValidateString(text,'wifi'); } else showInfoToast('No QR found.'); });

async function decodeImageToText(imgURL){
  // 1) BarcodeDetector
  if ('BarcodeDetector' in window){
    try{
      const det=new window.BarcodeDetector({ formats:['qr_code'] });
      const img=await loadImage(imgURL); const c=document.createElement('canvas'); c.width=img.width; c.height=img.height; c.getContext('2d').drawImage(img,0,0);
      const res=await det.detect(c); if(res && res[0] && res[0].rawValue) return res[0].rawValue;
    }catch(e){}
  }
  // 2) ZXing WASM (offline)
  if (window.ZXing && typeof window.ZXing === 'function'){
    try{
      const z = await window.ZXing(); const img=await loadImage(imgURL);
      const c=document.createElement('canvas'); c.width=img.width; c.height=img.height; c.getContext('2d').drawImage(img,0,0);
      const id=c.getContext('2d').getImageData(0,0,c.width,c.height);
      const res = z.readBarcodeFromImage(id.data, c.width, c.height, true, true);
      if (res && res.text) return res.text;
    }catch(e){}
  }
  // 3) Optional UMD fallback
  if (window.ZXingBrowser && window.ZXingBrowser.BrowserQRCodeReader){
    try{
      const img=await loadImage(imgURL); const reader=new window.ZXingBrowser.BrowserQRCodeReader();
      const res=await reader.decodeFromImage(img); const tx=(res && (res.text || (res.getText && res.getText())))||''; if(tx) return tx;
    }catch(e){}
  }
  return '';
}
function loadImage(url){ return new Promise((res,rej)=>{ const img=new Image(); img.onload=()=>res(img); img.onerror=rej; img.src=url; }); }

function doValidateString(s, scope='main'){
  const badge = scope==='wifi' ? $('#valStatusW') : $('#valStatus');
  const details = scope==='wifi' ? $('#valDetailsW') : $('#valDetails');
  if(!badge || !details) return;
  details.textContent='';
  if(!s){ badge.className='badge'; badge.textContent='—'; return; }
  if(/^LPA:1\$/i.test(s)){ const v=validateLPA(s);
    if(v.ok){ badge.className='badge ok'; badge.textContent='OK';
      const p=v.parts; details.innerHTML=`<div><strong>SM-DP+:</strong> ${p.smdp}</div>${p.matching?`<div><strong>Matching:</strong> ${p.matching}</div>`:''}<div><strong>Activation:</strong> ${p.activation}</div>${p.confirmation?`<div><strong>Confirmation:</strong> ${p.confirmation}</div>`:''}<div class="muted small">${v.format==='3part'?'3-part LPA':'2-part LPA'}</div>`;
    } else { badge.className='badge err'; badge.textContent='ERROR'; details.textContent=v.reason||'Invalid LPA'; }
    return;
  }
  if(/^WIFI:/i.test(s)){ const w=parseWiFi(s); if(w){ badge.className='badge ok'; badge.textContent='OK';
      details.innerHTML=`<div><strong>Type:</strong> ${w.T}</div><div><strong>SSID:</strong> ${w.S}</div><div><strong>Password:</strong> ${w.P? '••••••' : '(none)'}</div><div><strong>Hidden:</strong> ${w.H||'false'}</div>`; return; } }
  badge.className='badge err'; badge.textContent='UNKNOWN'; details.textContent='Unsupported string format.';
}

/* Feature matrix (mini) */
function renderFeatureMatrix(){
  const row = (label, freeOK, proOK=true) =>
    `<div class="fm-row fm-grid"><div>${label}</div><div>${freeOK?'✅':'🔒'} <span class="muted">Free</span> · ${proOK?'✅':'—'} <span class="muted">Pro</span></div></div>`;
  // Presets
  const fmPresets=$('#fm-presets'); if(fmPresets) fmPresets.innerHTML = `
    <div class="fm-title">Features</div>
    <div class="fm-grid">
      <div>LPA templates</div><div>✅ <span class="muted">Free</span> · ✅ <span class="muted">Pro</span></div>
      <div>Hints & tips</div><div>✅ <span class="muted">Free</span> · ✅ <span class="muted">Pro</span></div>
    </div>
    <div class="fm-note">Presets are available to all plans.</div>`;
  // Builder (eSIM)
  const fmBuilder=$('#fm-builder'); if(fmBuilder) fmBuilder.innerHTML = `
    <div class="fm-title">Features</div>
    ${row('PNG export', true)}
    ${row('SVG export', true)}
    ${row('Watermark removed', false, true)}
    ${row('Print-ready indicator', true)}
  `;
  // Batch
  const fmBatch=$('#fm-batch'); if(fmBatch) fmBatch.innerHTML = `
    <div class="fm-title">Features</div>
    ${row('CSV import', true)} <!-- Free dozvoljava 1 red -->
    ${row('ZIP (PNG + SVG)', true)}
    ${row('PDF A4 sheet from CSV', true)}
  `;
  // Sheets
  const fmSheets=$('#fm-sheets'); if(fmSheets) fmSheets.innerHTML = `
    <div class="fm-title">Features</div>
    ${row('Avery presets (3×4, 4×5, 5×7)', true)}
    ${row('Custom margins / gaps', true)}
    ${row('Center logo overlay', true)}
    ${row('Label text under QR', true)}
    ${row('Page watermark removed', false, true)}
  `;
  // Validate
  const fmValidate=$('#fm-validate'); if(fmValidate) fmValidate.innerHTML = `
    <div class="fm-title">Features</div>
    ${row('LPA/Wi-Fi string validation', true)}
    ${row('QR image decode (BarcodeDetector)', true)}
    ${row('QR image decode (ZXing WASM offline)', true)}
  `;
}

/* Init */
async function init(){
  $('#planBadge').textContent=getPlan().name.toUpperCase();
  await loadPresets(); renderPresets(); renderHistory(); renderFeatureMatrix(); tset();
  showView('esim'); // default
  if('serviceWorker' in navigator){ try{ await navigator.serviceWorker.register('./sw.js'); } catch(err){ console.warn('SW reg failed', err); } }
}
init();
