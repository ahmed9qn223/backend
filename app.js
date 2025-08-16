// Minimal clean app.js (V7C) — multi-file loader + tabs + JW playback

const TIMEZONE = 'Asia/Bangkok';
const CAT_URL  = 'categories.json';

// ---- helpers ----
const arrOf = (x) => Array.isArray(x) ? x
  : (Array.isArray(x?.channels) ? x.channels
     : (x && typeof x==='object' ? Object.values(x) : []));

function safeGet(k){ try{ return localStorage.getItem(k); }catch{} }
function safeSet(k,v){ try{ localStorage.setItem(k,v); }catch{} }

function mountClock(){
  const el = document.getElementById('clock'); if(!el) return;
  const tick = ()=>{
    el.textContent = new Intl.DateTimeFormat('th-TH',{
      day:'2-digit', month:'short', year:'numeric',
      hour:'2-digit', minute:'2-digit', second:'2-digit',
      hour12:false, timeZone: TIMEZONE
    }).format(new Date()).replace(',', '');
  };
  tick(); setInterval(tick,1000);
  // now playing line
  let np = document.getElementById('now-playing');
  if(!np){ np = document.createElement('div'); np.id='now-playing'; np.className='now-playing'; el.after(np); }
  window.__setNowPlaying = (s='')=>{ np.textContent = s; np.title=s; };
}

let categories = { order:[], default:null, rules:{}, files:{} };
let channels = [];
let currentFilter = null;

async function loadData(){
  const CK = 'TV_DATA_CACHE_V7C';
  try{
    const cache = JSON.parse(localStorage.getItem(CK) || 'null');
    if (cache && Date.now()-cache.t < 12*60*60*1000){
      categories = cache.cat || categories;
      channels   = arrOf(cache.ch);
      return;
    }
  }catch{}

  // 1) categories
  categories = await fetch(CAT_URL, {cache:'no-store'}).then(r=>r.json()).catch(()=>categories);
  categories.order = categories.order || [];
  categories.files = categories.files || {};

  // 2) files list (use categories.files; if empty, try fallback to channels/<slug>.json)
  let files = [];
  for (const [cat, path] of Object.entries(categories.files)){
    if (typeof path === 'string' && path) files.push({file:path, cat, optional:true});
  }
  if (!files.length && categories.order?.length){
    const slug = s=>String(s).normalize('NFKD').replace(/[^\w\-]+/g,'-').toLowerCase();
    files = categories.order.map(n=>({file:`channels/${slug(n)}.json`, cat:n, optional:true}));
  }
  if (!files.length) files = [{file:'channels.json', optional:true}];

  // 3) fetch + merge
  let all = [];
  for (const f of files){
    try{
      const res = await fetch(f.file, {cache:'no-store'});
      if (!res.ok){ if (f.optional){ console.warn('skip', f.file, res.status); continue; } else { throw new Error(res.status); } }
      let data = await res.json();
      let arr = arrOf(data);
      if (f.cat) arr = arr.map(x => (x.category ? x : Object.assign({category:f.cat}, x)));
      all = all.concat(arr);
    }catch(e){
      if (!f.optional) console.warn('load failed', f.file, e);
    }
  }
  channels = arrOf(all);
  channels.forEach((c,i)=>{ if(!c.id) c.id = (c.name||'ch').toString().toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9\-]/g,'')+'-'+i });

  localStorage.setItem(CK, JSON.stringify({t:Date.now(), cat:categories, ch:channels}));
}

function getCategory(ch){ return ch.category || categories.default || (categories.order[0]||'ทั้งหมด'); }

function buildTabs(){
  const root = document.getElementById('tabs'); if(!root) return;
  root.innerHTML = '';
  (categories.order||[]).forEach(name=>{
    const btn = document.createElement('button');
    btn.className = 'tab';
    btn.dataset.filter = name;
    btn.innerHTML = `<span class="tab-card"><span class="tab-label">${name}</span></span>`;
    btn.addEventListener('click', ()=>{ setActiveTab(name); });
    root.appendChild(btn);
  });
  if (!currentFilter) currentFilter = categories.default || categories.order[0] || null;
  setActiveTab(currentFilter);
}

function setActiveTab(name){
  currentFilter = name;
  const root = document.getElementById('tabs'); if(!root) return;
  root.querySelectorAll('.tab').forEach(b=> b.setAttribute('aria-selected', b.dataset.filter===name?'true':'false'));
  render();
}

function ensureGrid(){
  const grid = document.getElementById('channel-list');
  if (grid && !grid.classList.contains('grid')) grid.classList.add('grid');
  return grid;
}

function render(){
  const grid = ensureGrid(); if(!grid) return; grid.innerHTML='';
  const list = arrOf(channels).filter(c=>getCategory(c)===currentFilter);
  if (!list.length){ grid.innerHTML = `<div style="padding:1.5rem;opacity:.8;text-align:center">ไม่พบช่องในหมวดนี้</div>`; return; }

  list.forEach(ch=>{
    const idx = arrOf(channels).indexOf(ch);
    const btn = document.createElement('button');
    btn.className = 'channel';
    btn.dataset.globalIndex = String(idx);
    btn.title = ch.name || 'ช่อง';
    btn.innerHTML = `
      <div class="ch-card">
        <div class="logo-wrap">
          <img class="logo" loading="lazy" src="${(ch.logo||'').replace(/"/g,'&quot;')}" alt="${(ch.name||'โลโก้ช่อง').replace(/"/g,'&quot;')}">
        </div>
        <div class="name">${(ch.name||'ช่อง').replace(/</g,'&lt;')}</div>
      </div>`;
    btn.addEventListener('click', ()=> playByIndex(idx));
    grid.appendChild(btn);
  });
}

function detectType(u){ return /\.mpd(\?|$)/.test(u)?'dash':'hls'; }

function buildSources(ch){
  if (Array.isArray(ch.sources) && ch.sources.length){
    return [...ch.sources].sort((a,b)=>(a.priority||99)-(b.priority||99));
  }
  const s = ch.src || ch.file; if(!s) return [];
  return [{ src:s, type: ch.type||detectType(s), drm: ch.drm }];
}

function makeJwSource(s){ return { file:s.src, type:(s.type==='dash'?'dash':'hls'), drm:s.drm||undefined }; }

function tryPlayJW(ch, list, i){
  if (i>=list.length){ console.warn('ทุกแหล่งเล่นไม่สำเร็จ:', ch.name); window.__setNowPlaying(''); return; }
  const p = jwplayer('player').setup({
    file: makeJwSource(list[i]).file,
    type: makeJwSource(list[i]).type,
    drm:  makeJwSource(list[i]).drm,
    width:'100%', height:'100%', autostart:true, mute:true,
    abouttext:'FLOWTV', aboutlink:'#'
  });
  p.on('error', ()=> tryPlayJW(ch, list, i+1));
  p.on('play', ()=> { if (p.getMute()) p.setMute(false); });
}

let currentIndex = -1;
function playByIndex(i){
  const ch = arrOf(channels)[i]; if(!ch) return;
  currentIndex = i;
  safeSet('lastId', ch.id);
  const srcs = buildSources(ch);
  tryPlayJW(ch, srcs, 0);
  window.__setNowPlaying?.(ch.name||'');
}

document.addEventListener('DOMContentLoaded', async ()=>{
  mountClock();
  await loadData();
  buildTabs();
  // auto-resume last
  const last = safeGet('lastId');
  if (last){
    const idx = arrOf(channels).findIndex(c=>c.id===last);
    if (idx>=0) playByIndex(idx);
  }
});
