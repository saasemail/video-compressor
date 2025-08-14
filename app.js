// app.js — Minimal 3-tool bundle (offline, no tracking, no Pro layer)
// Requires window.QRCode and window.jspdf.jsPDF

const $  = (s, r=document)=>r.querySelector(s);
const $$ = (s, r=document)=>Array.from(r.querySelectorAll(s));

/* ---------- Navigation ---------- */
function showView(view){
  $$('#view-esim, #view-wifi, #view-sheets').forEach(v=>v.classList.add('hidden'));
  $(`#view-${view}`).classList.remove('hidden');
  if(view==='esim') $('#view-esim').scrollIntoView({behavior:'smooth', block:'start'});
  if(view==='wifi') $('#view-wifi').scrollIntoView({behavior:'smooth', block:'start'});
  if(view==='sheets') $('#view-sheets').scrollIntoView({behavior:'smooth', block:'start'});
}
$('#toolEsim').addEventListener('click', ()=>showView('esim'));
$('#toolWifi').addEventListener('click', ()=>showView('wifi'));
$('#toolSheets').addEventListener('click', ()=>showView('sheets'));
$('#startNow').addEventListener('click', ()=>showView('esim'));

/* ---------- PWA install (optional) ---------- */
let deferredPrompt=null;
window.addEventListener('beforeinstallprompt', (e)=>{ e.preventDefault(); deferredPrompt=e; $('#installPWA').hidden=false; });
$('#installPWA')?.addEventListener('click', async ()=>{
  if(!deferredPrompt) return;
  deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt=null; $('#installPWA').hidden=true;
});

/* ---------- eSIM (Lite) ---------- */
const ESIM_CANVAS = $('#qrEsim');
const ESIM_DL = $('#dlEsim');
const LPA_OUT = $('#lpaOut');

function buildLPA({smdp, activation, matching}) {
  const parts = ['LPA:1'];
  if (smdp) parts.push(smdp.trim());
  if (matching) { parts.push(matching.trim()); if (activation) parts.push(activation.trim()); }
  else if (activation) parts.push(activation.trim());
  return parts.join('$');
}

function syncEsimRaw() {
  const smdp = $('#smdp').value;
  const activation = $('#activation').value;
  const matching = $('#matching').value;
  $('#lpaRaw').value = buildLPA({smdp, activation, matching});
}

async function renderEsim() {
  const text = $('#lpaRaw').value.trim();
  if (!text) return;
  await drawQRToCanvas(ESIM_CANVAS, text);
  LPA_OUT.textContent = text;
  ESIM_DL.href = await canvasToPngURL(ESIM_CANVAS);
  lastQR.url = ESIM_DL.href;
  lastQR.text = text;
}

['input','change'].forEach(ev=>{
  $('#smdp').addEventListener(ev, ()=>{ syncEsimRaw(); renderEsim(); });
  $('#activation').addEventListener(ev, ()=>{ syncEsimRaw(); renderEsim(); });
  $('#matching').addEventListener(ev, ()=>{ syncEsimRaw(); renderEsim(); });
  $('#lpaRaw').addEventListener(ev, renderEsim);
});
$('#copyLpa').addEventListener('click', async ()=>{
  const s = $('#lpaRaw').value.trim(); if(!s) return;
  try { await navigator.clipboard.writeText(s); } catch {}
});

/* Defaults (instant preview) */
$('#smdp').value = 'smdp.example.com';
$('#activation').value = '1234-5678-90AB-CDEF';
$('#matching').value = '';
syncEsimRaw();

/* ---------- Wi-Fi (Lite) ---------- */
const WIFI_CANVAS = $('#qrWifi');
const WIFI_DL = $('#dlWifi');
const WIFI_OUT = $('#wifiOut');

function escapeWiFi(s){ return (s||'').replace(/([;,:\\"])/g,'\\$1'); }
function buildWiFi({ssid, security, pass, hidden}){
  const T = (security==='nopass'?'nopass':'WPA');
  const P = (T==='nopass') ? '' : (pass||'');
  const H = hidden ? 'true' : 'false';
  return `WIFI:T:${T};S:${escapeWiFi(ssid||'')};P:${escapeWiFi(P)};H:${H};;`;
}

function syncWifiRaw(){
  const ssid = $('#ssid').value;
  const security = $('#security').value;
  const pass = $('#wifiPass').value;
  const hidden = $('#hidden').value === 'true';
  $('#wifiRaw').value = buildWiFi({ssid, security, pass, hidden});
  $('#wifiPass').disabled = (security==='nopass');
}

async function renderWifi(){
  const text = $('#wifiRaw').value.trim();
  if (!text) return;
  await drawQRToCanvas(WIFI_CANVAS, text);
  WIFI_OUT.textContent = text;
  WIFI_DL.href = await canvasToPngURL(WIFI_CANVAS);
  lastQR.url = WIFI_DL.href;
  lastQR.text = text;
}

['input','change'].forEach(ev=>{
  $('#ssid').addEventListener(ev, ()=>{ syncWifiRaw(); renderWifi(); });
  $('#security').addEventListener(ev, ()=>{ syncWifiRaw(); renderWifi(); });
  $('#wifiPass').addEventListener(ev, ()=>{ syncWifiRaw(); renderWifi(); });
  $('#hidden').addEventListener(ev, ()=>{ syncWifiRaw(); renderWifi(); });
  $('#wifiRaw').addEventListener(ev, renderWifi);
});
$('#copyWifi').addEventListener('click', async ()=>{
  const s = $('#wifiRaw').value.trim(); if(!s) return;
  try { await navigator.clipboard.writeText(s); } catch {}
});

/* Defaults */
$('#ssid').value = 'CafeDemo';
$('#security').value = 'WPA';
$('#wifiPass').value = 'secret123';
$('#hidden').value = 'false';
syncWifiRaw();

/* ---------- Shared QR render helpers ---------- */
const QR_OPTIONS = { width: 512, margin: 8, errorCorrectionLevel: 'Q', color:{dark:'#000', light:'#fff'} };
async function drawQRToCanvas(canvas, text){
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0,0,canvas.width,canvas.height);
  await window.QRCode.toCanvas(canvas, text, QR_OPTIONS);
}
function canvasToPngURL(canvas){
  return new Promise(res=>canvas.toBlob(b=>res(URL.createObjectURL(b)), 'image/png'));
}

/* ---------- PDF Sheet (Lite) ---------- */
const lastQR = { url: null, text: '' };
$('#previewPDF').addEventListener('click', async ()=>{ const blob = await buildPdfFromLastQR({ preview:true }); if(!blob) return;
  const url = URL.createObjectURL(blob); $('#pdfPreview').hidden=false; $('#pdfFrame').src = url;
});
$('#downloadPDF').addEventListener('click', async ()=>{ const blob = await buildPdfFromLastQR({ preview:false }); if(!blob) return;
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='qr_sheet.pdf'; a.click();
});

function gridFromSelect(){
  const v = $('#grid').value;
  if (v==='4x5') return { cols:4, rows:5 };
  return { cols:3, rows:4 };
}

async function buildPdfFromLastQR({preview}){
  if(!lastQR.url){ alert('Generate a QR first (eSIM or Wi-Fi).'); return null; }
  try{
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit:'mm', format:'a4' });
    const W=210, H=297, margin=10, gap=4;
    const { cols, rows } = gridFromSelect();
    const cellW = (W - margin*2 - gap*(cols-1)) / cols;
    const cellH = (H - margin*2 - gap*(rows-1)) / rows;
    const label = $('#labelAll').value || '';
    let idx=0;
    for(let r=0;r<rows;r++){
      for(let c=0;c<cols;c++){
        const x = margin + c*(cellW+gap);
        const y = margin + r*(cellH+gap);
        const qrSize = Math.min(cellW, cellH - (label?8:0));
        doc.addImage(lastQR.url, 'PNG', x, y, qrSize, qrSize);
        if(label){ doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.text(label, x+qrSize/2, y+qrSize+5.5, {align:'center', baseline:'middle'}); }
        idx++;
      }
    }
    return doc.output('blob');
  }catch(e){ console.error(e); alert('Failed to build PDF.'); return null; }
}

/* ---------- Init ---------- */
async function init(){
  showView('esim');        // default tab
  await renderEsim();      // instant preview
  await renderWifi();      // prepare wifi panel too
  if('serviceWorker' in navigator){
    try{ await navigator.serviceWorker.register('./sw.js'); }catch(e){ console.warn('SW reg failed', e); }
  }
}
init();
