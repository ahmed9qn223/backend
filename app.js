// ===== Global settings & keys =====
const SETTINGS_KEY = 'TV_SETTINGS_V1';
const CACHE_KEY    = 'TV_DATA_CACHE_V1';

let SETTINGS = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
if (!('lowBandwidth' in SETTINGS)) SETTINGS.lowBandwidth = false;
function saveSettings(){ localStorage.setItem(SETTINGS_KEY, JSON.stringify(SETTINGS)); }

// ===== Utility =====
function $(q,root=document){ return root.querySelector(q); }
function $all(q,root=document){ return Array.from(root.querySelectorAll(q)); }

function slugify(s){ return (s||'').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'') || 'ch-'+Math.random().toString(36).slice(2); }
function detectType(u){
  if (!u) return 'hls';
  const q = u.split('?')[0];
  if (q.endsWith('.mpd')) return 'dash';
  if (q.endsWith('.m3u8')) return 'hls';
  if (/type=dash|format=dash/i.test(u)) return 'dash';
  return 'hls';
}
function withProxy(u){
  try{
    const base = (window.PROXY_BASE || '').trim();
    if (!base) return u;
    const b64 = btoa(u);
    return base.replace(/\/$/,'') + '/p/' + b64;
  }catch{ return u; }
}
function withTimeout(promise, ms, label='op'){
  return Promise.race([promise, new Promise((_,rej)=> setTimeout(()=> rej(new Error('timeout:'+label)), ms))]);
}

// ===== Low-bandwidth player configs =====
function buildHlsConfig(){
  if (!SETTINGS.lowBandwidth) {
    return {
      lowLatencyMode: false,
      capLevelToPlayerSize: true,
      maxBufferLength: 30,
      liveSyncDurationCount: 3,
      fragLoadingTimeOut: 15000,
      manifestLoadingTimeOut: 15000,
      levelLoadingTimeOut: 15000,
      manifestLoadingMaxRetry: 2,
      levelLoadingMaxRetry: 2,
      fragLoadingMaxRetry: 1
    };
  }
  return {
    lowLatencyMode: true,
    capLevelToPlayerSize: true,
    startLevel: 0,
    maxBufferLength: 10,
    liveSyncDurationCount: 2,
    maxLiveSyncPlaybackRate: 1.0,
    backBufferLength: 10,
    fragLoadingTimeOut: 8000,
    manifestLoadingTimeOut: 8000,
    levelLoadingTimeOut: 8000,
    manifestLoadingMaxRetry: 3,
    levelLoadingMaxRetry: 3,
    fragLoadingMaxRetry: 2
  };
}
function buildShakaConfig(){
  const base = {
    'manifest.retryParameters': { timeout: SETTINGS.lowBandwidth?8000:15000, maxAttempts: SETTINGS.lowBandwidth?3:2 },
    'streaming.retryParameters': { timeout: SETTINGS.lowBandwidth?8000:15000, maxAttempts: SETTINGS.lowBandwidth?3:2 },
    'drm.retryParameters': { timeout: SETTINGS.lowBandwidth?8000:15000, maxAttempts: SETTINGS.lowBandwidth?3:2 },
    'abr.enabled': true
  };
  if (!SETTINGS.lowBandwidth) {
    return Object.assign(base, {
      'streaming.bufferingGoal': 25,
      'streaming.rebufferingGoal': 5,
      'streaming.lowLatencyMode': false,
      'abr.defaultBandwidthEstimate': 1_200_000
    });
  }
  return Object.assign(base, {
    'streaming.bufferingGoal': 10,
    'streaming.rebufferingGoal': 2,
    'streaming.lowLatencyMode': true,
    'abr.defaultBandwidthEstimate': 300_000
  });
}

// ===== Toasts & Reporting =====
function showToast(message, actions=[]){
  const box = document.getElementById('toastStack');
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<div>${message}</div>`;
  if (actions.length){
    const row = document.createElement('div');
    row.className = 'toast-actions';
    actions.forEach(a=>{
      const btn = document.createElement('button');
      btn.textContent = a.label;
      btn.className = a.variant === 'primary' ? 'primary' : 'ghost';
      btn.onclick = ()=>{ try{ a.onClick?.(); } finally{ el.remove(); } };
      row.appendChild(btn);
    });
    el.appendChild(row);
  }
  box.appendChild(el);
  setTimeout(()=> el.remove(), 8000);
}

function reportBroken(currentChannel){
  const payload = {
    id: currentChannel?.id, name: currentChannel?.name,
    ts: Date.now(), ua: navigator.userAgent
  };
  if (!window.REPORT_WEBHOOK){
    console.warn('Report payload:', payload);
    showToast('บันทึกรายงานไว้แล้ว (โหมดทดสอบ)');
    return;
  }
  fetch(window.REPORT_WEBHOOK, {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(payload)})
    .then(()=> showToast('ส่งรายงานเรียบร้อย'))
    .catch(()=> showToast('ส่งรายงานไม่สำเร็จ'));
}

// ===== Data loading with cache bust via version.json =====
async function getDataVersion(){
  try{
    const v = await fetch('version.json', {cache:'no-store'}).then(r=>r.json());
    return v?.dataVersion || '';
  }catch{ return ''; }
}
async function loadDataSmart(){
  const ver = await getDataVersion();
  const hit = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
  if (hit && hit.ver === ver && (Date.now() - hit.t) < 12*60*60*1000){
    window.CATEGORIES = hit.cat; window.CHANNELS = hit.ch;
    return;
  }
  const [cat, ch] = await Promise.all([
    fetch('categories.json', {cache:'no-store'}).then(r=>r.json()),
    fetch('channels.json',   {cache:'no-store'}).then(r=>r.json())
  ]);
  window.CATEGORIES = cat; window.CHANNELS = ch;
  localStorage.setItem(CACHE_KEY, JSON.stringify({t:Date.now(), ver, cat, ch}));
}
function forceRefreshList(){
  localStorage.removeItem(CACHE_KEY);
  showToast('กำลังรีเฟรชรายการช่อง...');
  loadDataSmart().then(()=> {
    renderAll();
    applyHealthBadges();
    showToast('อัปเดตรายการช่องแล้ว');
  });
}

// ===== Build sources from channel object =====
function buildSources(ch){
  const list = Array.isArray(ch.sources) && ch.sources.length
    ? [...ch.sources].sort((a,b)=>(a.priority||99)-(b.priority||99))
    : [{ src: ch.src || ch.file, type: ch.type || detectType(ch.src||ch.file), drm: ch.drm }];

  return list.map(s => ({
    src: withProxy(s.src || s.file),
    type: s.type || detectType(s.src || s.file),
    drm: s.drm || ch.drm || null
  })).filter(s => !!s.src);
}

// ===== Rendering =====
let CURRENT_INDEX = -1, CURRENT_SOURCE_INDEX = 0;
let CURRENT_CHANNEL = null, CURRENT_ENGINE = null, CURRENT_API = null;
let ACTIVE_CATEGORY = ''; let SEARCH_TEXT = '';

function ensureIds(){
  if (Array.isArray(CHANNELS)) CHANNELS.forEach(ch=>{ if(!ch.id) ch.id = slugify(ch.name || ch.title); });
  if (Array.isArray(CATEGORIES)) CATEGORIES.forEach(c=>{ if(!c.id) c.id = slugify(c.name); });
}
function renderAll(){
  ensureIds();
  renderCategories();
  renderGrid();
}
function renderCategories(){
  const bar = $('#categoriesBar'); if (!bar) return;
  bar.innerHTML = '';
  const allBtn = document.createElement('button');
  allBtn.className = 'cat-btn' + (ACTIVE_CATEGORY ? '' : ' active'); 
  allBtn.textContent = 'ทั้งหมด'; allBtn.dataset.id = '';
  bar.appendChild(allBtn);
  (CATEGORIES||[]).forEach(cat=>{
    const b = document.createElement('button');
    b.className = 'cat-btn' + (ACTIVE_CATEGORY===cat.id ? ' active' : '');
    b.textContent = cat.name; b.dataset.id = cat.id; bar.appendChild(b);
  });
  // event delegation (NO once:true)
  bar.addEventListener('click', ev=>{
    const btn = ev.target.closest('.cat-btn'); if (!btn) return;
    ACTIVE_CATEGORY = btn.dataset.id || '';
    $all('.cat-btn', bar).forEach(x=>x.classList.toggle('active', x===btn));
    renderGrid();
  });
}

function renderGrid(){
  const grid = $('#grid'); const empty = $('#emptyState');
  if (!grid) return;
  grid.innerHTML='';
  const list = (CHANNELS||[]).filter(ch => {
    const hitCat = !ACTIVE_CATEGORY || ch.category === ACTIVE_CATEGORY || ch.categoryId === ACTIVE_CATEGORY;
    const hitText = !SEARCH_TEXT || (ch.name||'').toLowerCase().includes(SEARCH_TEXT) || (ch.title||'').toLowerCase().includes(SEARCH_TEXT);
    return hitCat && hitText;
  });
  if (!list.length){
    empty.hidden = false; return;
  } else empty.hidden = true;

  list.forEach((ch,idx)=>{
    const card = document.createElement('div');
    card.className = 'card'; card.tabIndex = 0; card.dataset.channelId = ch.id;
    const logo = ch.logo || ch.icon;
    card.innerHTML = `
      <div class="thumb">
        ${logo ? `<img alt="" src="${logo}" loading="lazy">` : ''}
        <span class="badge" hidden>รอเช็ค</span>
      </div>
      <div class="body">
        <div class="title">${ch.name || ch.title || 'ช่องไม่ระบุชื่อ'}</div>
        <div class="meta"><span class="meta-cat">${findCategoryName(ch.category || ch.categoryId) || ''}</span></div>
      </div>
    `;
    card.addEventListener('click', ()=> playById(ch.id));
    grid.appendChild(card);
  });
}
function findCategoryName(id){
  const c = (CATEGORIES||[]).find(x=> x.id===id); return c?.name || '';
}

// ===== Player boot with fallback across sources =====
function teardownPlayer(){
  try{
    if (CURRENT_ENGINE === 'shaka' && CURRENT_API){ CURRENT_API.destroy(); }
    if (CURRENT_ENGINE === 'hls' && CURRENT_API){ CURRENT_API.destroy(); }
  }catch{}
  CURRENT_API = null; CURRENT_ENGINE = null;
}
async function playById(id){
  const idx = (CHANNELS||[]).findIndex(x=> x.id===id);
  if (idx < 0) return;
  return playByIndex(idx);
}
async function playByIndex(idx){
  const ch = CHANNELS[idx]; if (!ch) return;
  CURRENT_INDEX = idx; CURRENT_SOURCE_INDEX = 0; CURRENT_CHANNEL = ch;
  const sources = buildSources(ch);
  if (!sources.length){ showToast('ช่องนี้ยังไม่มีแหล่งสตรีม'); return; }
  $('#nowTitle').textContent = ch.name || ch.title || 'ไม่ระบุชื่อ';
  $('#nowMeta').textContent  = findCategoryName(ch.category || ch.categoryId) || '';
  document.body.classList.add('is-playing');
  await tryPlaySources(sources);
}
async function tryPlaySources(sources){
  const video = $('#player'); teardownPlayer();
  let lastErr = null;
  for (let i=0; i<sources.length; i++){
    CURRENT_SOURCE_INDEX = i;
    const s = sources[i];
    try{
      const res = await bootEngine(s, video);
      CURRENT_ENGINE = res.engine; CURRENT_API = res.api;
      showToast(`กำลังเล่น: แหล่งที่ ${i+1}/${sources.length}`);
      if (SETTINGS.lowBandwidth){ video.muted = true; try{ await video.play(); }catch{} }
      return;
    }catch(e){
      console.warn('source fail', s, e); lastErr = e;
    }
  }
  showToast('เล่นช่องนี้ไม่ได้', [
    {label:'ลองใหม่', variant:'primary', onClick:()=> tryPlaySources(sources) },
    {label:'รายงานช่องเสีย', onClick:()=> reportBroken(CURRENT_CHANNEL) }
  ]);
  throw lastErr || new Error('no source works');
}
async function bootEngine(source, video){
  const url = source.src, type = source.type || detectType(url);
  if (type === 'dash') return withTimeout(playWithShaka(url, video, source), SETTINGS.lowBandwidth?6000:10000, 'shaka');
  if (type === 'hls')  return withTimeout(playWithHls(url, video), SETTINGS.lowBandwidth?6000:10000, 'hls');
  return withTimeout(playWithHls(url, video), SETTINGS.lowBandwidth?6000:10000, 'hls');
}
async function playWithHls(url, video){
  if (video.canPlayType('application/vnd.apple.mpegURL')){
    video.src = url; await video.play().catch(()=>{});
    return {engine:'native', api:null};
  }
  if (!window.Hls || !Hls.isSupported()) throw new Error('hls.js not supported');
  const hls = new Hls(buildHlsConfig());
  hls.loadSource(url);
  hls.attachMedia(video);
  return new Promise((resolve, reject)=>{
    const onErr = (_,data)=>{ if (data?.fatal) { hls.destroy(); reject(data); } };
    hls.on(Hls.Events.MANIFEST_PARSED, ()=> resolve({engine:'hls', api:hls}));
    hls.on(Hls.Events.ERROR, onErr);
  });
}
async function playWithShaka(url, video, source){
  if (!window.shaka) throw new Error('shaka not loaded');
  const player = new shaka.Player(video);
  player.configure(buildShakaConfig());
  if (source?.drm?.clearkey?.keyId && source?.drm?.clearkey?.key){
    const kId = source.drm.clearkey.keyId.trim(); const k = source.drm.clearkey.key.trim();
    const map = {}; map[kId] = k;
    player.configure({ drm: { clearKeys: map } });
  }
  await player.load(url);
  return {engine:'shaka', api:player};
}
function tryNextSource(){
  const ch = CURRENT_CHANNEL; if (!ch) return;
  const sources = buildSources(ch);
  if (!sources.length) return;
  CURRENT_SOURCE_INDEX = Math.min(CURRENT_SOURCE_INDEX+1, sources.length-1);
  const ordered = sources.slice(CURRENT_SOURCE_INDEX).concat(sources.slice(0, CURRENT_SOURCE_INDEX));
  tryPlaySources(ordered);
}

// ===== Health badges =====
async function fetchHealth(){
  try{
    if (!window.HEALTH_URL) return null;
    const res = await fetch(window.HEALTH_URL, {cache:'no-store'});
    return await res.json();
  }catch{ return null; }
}
async function applyHealthBadges(){
  const map = await fetchHealth(); if (!map) return;
  $all('[data-channel-id]').forEach(card=>{
    const id = card.getAttribute('data-channel-id');
    const info = map[id];
    if (!info) return;
    const status = info.up ? (info.latency>1500 ? 'warn':'up') : 'down';
    const badge = card.querySelector('.badge');
    if (!badge) return;
    badge.hidden = false;
    badge.className = `badge ${status}`;
    badge.textContent = info.up ? (status==='warn' ? 'หน่วง' : 'ปกติ') : 'ล่ม';
    const ts = new Date(info.checkedAt || Date.now()).toLocaleString();
    badge.title = `เช็คล่าสุด: ${ts}` + (info.latency? ` • ${info.latency} ms` : '');
  });
}

// ===== Boot =====
document.addEventListener('DOMContentLoaded', async ()=>{
  // Toggle low bandwidth
  const lowToggle = $('#lowBandwidthToggle');
  if (lowToggle){ lowToggle.checked = !!SETTINGS.lowBandwidth;
    lowToggle.addEventListener('change', ()=>{
      SETTINGS.lowBandwidth = !!lowToggle.checked; saveSettings();
      showToast(SETTINGS.lowBandwidth? 'เปิดโหมดเน็ตช้า' : 'ปิดโหมดเน็ตช้า');
    });
  }
  const btnRefresh = $('#refreshListBtn');
  if (btnRefresh) btnRefresh.addEventListener('click', ()=> forceRefreshList());

  const search = $('#q');
  if (search){
    search.addEventListener('input', ()=>{
      SEARCH_TEXT = (search.value||'').trim().toLowerCase();
      renderGrid();
      applyHealthBadges();
    });
  }

  await loadDataSmart();
  renderAll();

  const urlCh = new URLSearchParams(location.search).get('ch');
  if (urlCh){ playById(urlCh); }

  applyHealthBadges();
  if (window.HEALTH_URL) setInterval(applyHealthBadges, 90*1000);
});
