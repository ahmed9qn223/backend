/* FLOWTV – Tabs + Grid + Player
 * - เปลี่ยนหมวด "ข่าว" -> "IPTV"
 * - เพิ่มหมวด "เด็ก"
 * - สร้างแท็บอัตโนมัติ + ค้นหา + เล่น HLS/DASH
 */

const TABS = ['ทั้งหมด', 'IPTV', 'เด็ก', 'บันเทิง', 'กีฬา', 'สารคดี', 'เพลง', 'หนัง'];
const tabsEl = document.getElementById('tabs');
const gridEl = document.getElementById('grid');
const qEl = document.getElementById('q');

const modal = document.getElementById('playerModal');
const modalTitle = document.getElementById('playerTitle');
const metaEl = document.getElementById('meta');
const videoEl = document.getElementById('player');

let channels = [];
let activeFilter = 'ทั้งหมด';
let hlsInstance = null;
let dashInstance = null;

const isStr = v => typeof v === 'string';
const byStr = v => (v || '').toString();

/* -------- Category helpers -------- */
function getIconSVG(n){
  const s='currentColor', w=2;
  switch(n){
    case 'IPTV': 
      return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="3" y="7" width="18" height="12" rx="2" stroke="${s}" stroke-width="${w}"/>
        <path d="M8 4l4 3 4-3" stroke="${s}" stroke-width="${w}" stroke-linecap="round"/>
      </svg>`;
    case 'เด็ก':
      return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="${s}" stroke-width="${w}"/>
        <path d="M8.5 10.5h.01M15.5 10.5h.01" stroke="${s}" stroke-width="${w}" stroke-linecap="round"/>
        <path d="M8.5 14c1 .9 2.2 1.4 3.5 1.4S14.5 14.9 15.5 14" stroke="${s}" stroke-width="${w}" stroke-linecap="round"/>
      </svg>`;
    case 'บันเทิง': return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 4l2.7 5.5 6 .9-4.4 4.3 1 6-5.3-2.8-5.3 2.8 1-6L3.3 10.4l6-.9L12 4z" stroke="${s}" stroke-width="${w}" stroke-linejoin="round"/></svg>`;
    case 'กีฬา': return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="${s}" stroke-width="${w}"/><path d="M3 12h18" stroke="${s}" stroke-width="${w}" stroke-linecap="round"/><path d="M12 3a9 9 0 0 1 0 18" stroke="${s}" stroke-width="${w}" stroke-linecap="round"/><path d="M12 3a9 9 0 0 0 0 18" stroke="${s}" stroke-width="${w}" stroke-linecap="round"/></svg>`;
    case 'สารคดี': return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 6h7a3 3 0 0 1 3 3v11H7a3 3 0 0 0-3 3V6z" stroke="${s}" stroke-width="${w}" stroke-linejoin="round"/><path d="M13 6h7a3 3 0 0 1 3 3v11h-7a3 3 0 0 0-3 3V6z" stroke="${s}" stroke-width="${w}" stroke-linejoin="round"/></svg>`;
    case 'เพลง':   return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M14 4v9.5a2.5 2.5 0 1 1-2-2.45V8l-4 1v7a2 2 0 1 1-2-2V8.5l8-2.5Z" fill="${s}"/></svg>`;
    case 'หนัง':   return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="2" stroke="${s}" stroke-width="${w}"/><path d="M7 6v12M17 6v12" stroke="${s}" stroke-width="${w}" stroke-linecap="round"/></svg>`;
    case 'ทั้งหมด':
      return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3" stroke="${s}" stroke-width="${w}"/><path d="M7 7h10v10H7z" stroke="${s}" stroke-width="${w}" opacity=".5"/></svg>`;
    default:
      return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3" stroke="${s}" stroke-width="${w}"/></svg>`;
  }
}

function guessCategory(ch){
  const s = `${byStr(ch.name)} ${byStr(ch.logo)}`.toLowerCase();
  const src = byStr(ch.src || ch.file).toLowerCase();

  // หนัง
  if (/(^|\s)(hbo|cinemax|mono\s?29\s?plus|mono29plus|movie|movies|film|true\s?film|signature|hits|family)(\s|$)/.test(s)) return 'หนัง';
  if (/(\/101\/|\/103\/|\/104\/|\/105\/|\/106\/|\/107\/|\/109\/)/.test(src)) return 'หนัง';

  // IPTV (เดิม "ข่าว")
  if (/(ข่าว|tnn|nation|thairath|nbt|pbs|jkn|workpoint\s?news)/.test(s)) return 'IPTV';

  // เด็ก
  if (/(kid|เด็ก|cartoon|toon|junior|nick|animax|dreamworks|pbskids|zoo\s?moo|boomerang|baby|disney)/.test(s)) return 'เด็ก';

  // กีฬา / สารคดี / เพลง
  if (/(sport|กีฬา|t\s?sports|bein|true\s?sport|pptv\s?hd\s?36)/.test(s)) return 'กีฬา';
  if (/(สารคดี|discovery|animal|nat.?geo|history|documentary|bbc\s?earth)/.test(s)) return 'สารคดี';
  if (/(เพลง|music|mtv|channel\s?v|music\s?hits)/.test(s)) return 'เพลง';

  return 'บันเทิง';
}

/* -------- Data loading -------- */
function flattenOne(arr){
  // flatten 1 ชั้น เฉพาะตัวที่เป็น array
  if (!Array.isArray(arr)) return arr;
  if (!arr.some(Array.isArray)) return arr;
  return arr.reduce((acc, item) => acc.concat(item), []);
}

async function loadChannels(){
  const res = await fetch('channels.json', {cache:'no-store'});
  const data = await res.json();

  let list = Array.isArray(data) ? data : (data.channels || []);
  list = flattenOne(list);

  // sanitize & normalize
  channels = list
    .filter(x => x && typeof x === 'object')
    .map((ch, idx) => {
      const src = byStr(ch.src || ch.file || ch.url);
      const name = byStr(ch.name || `ช่อง #${idx+1}`);
      const logo = byStr(ch.logo || '');
      let category = byStr(ch.category).trim();
      if (!category) category = guessCategory({name, logo, src});

      // type: ถ้าไม่ระบุ ให้เดาจาก url
      let type = byStr(ch.type).toLowerCase();
      if (!type){
        if (/\.m3u8($|\?)/.test(src)) type = 'hls';
        else if (/\.mpd($|\?)/.test(src)) type = 'dash';
        else type = 'auto';
      }
      return { ...ch, name, logo, src, category, type };
    });

  buildTabs();
  render();
}

/* -------- UI: Tabs -------- */
function buildTabs(){
  tabsEl.innerHTML = '';
  const categoriesInData = new Set(channels.map(c => c.category));

  TABS.forEach(cat => {
    if (cat !== 'ทั้งหมด' && !categoriesInData.has(cat)) return;
    const btn = document.createElement('button');
    btn.className = 'tab';
    btn.type = 'button';
    btn.role = 'tab';
    btn.dataset.filter = cat;
    btn.setAttribute('aria-selected', cat === activeFilter ? 'true' : 'false');
    btn.innerHTML = `${getIconSVG(cat)}<span>${cat}</span>`;
    btn.addEventListener('click', () => {
      activeFilter = cat;
      document.querySelectorAll('.tab[role="tab"]').forEach(t => t.setAttribute('aria-selected','false'));
      btn.setAttribute('aria-selected','true');
      render();
    });
    tabsEl.appendChild(btn);
  });
}

/* -------- UI: Cards -------- */
function render(){
  const q = byStr(qEl.value).trim().toLowerCase();
  gridEl.innerHTML = '';

  const visible = channels.filter(ch => {
    const inFilter = (activeFilter === 'ทั้งหมด') ? true : (ch.category === activeFilter);
    if (!inFilter) return false;
    if (!q) return true;
    const hay = `${ch.name} ${ch.category} ${ch.logo} ${ch.src}`.toLowerCase();
    return hay.includes(q);
  });

  if (visible.length === 0){
    const empty = document.createElement('p');
    empty.className = 'card__meta';
    empty.style.padding = '14px';
    empty.textContent = 'ไม่พบช่องตามที่กรอง';
    gridEl.appendChild(empty);
    return;
  }

  for (const ch of visible){
    const card = document.createElement('article');
    card.className = 'card';
    card.dataset.category = ch.category;

    const thumb = document.createElement('div');
    thumb.className = 'card__thumb';
    thumb.innerHTML = ch.logo
      ? `<img src="${ch.logo}" alt="${escapeHtml(ch.name)} โลโก้">`
      : `<div class="badge">ไม่มีโลโก้</div>`;

    const body = document.createElement('div');
    body.className = 'card__body';
    const title = document.createElement('h3');
    title.className = 'card__title';
    title.textContent = ch.name;

    const meta = document.createElement('div');
    meta.className = 'card__meta';
    meta.innerHTML = `
      <span class="badge">${ch.category}</span>
      <span class="src">${prettyType(ch.type)}</span>
    `;

    const actions = document.createElement('div');
    actions.className = 'card__actions';
    const playBtn = document.createElement('button');
    playBtn.className = 'btn primary';
    playBtn.innerHTML = 'เล่นเลย ▶';
    playBtn.addEventListener('click', () => openPlayer(ch));

    actions.appendChild(playBtn);
    body.appendChild(title);
    body.appendChild(meta);
    body.appendChild(actions);

    card.appendChild(thumb);
    card.appendChild(body);
    gridEl.appendChild(card);
  }
}

function prettyType(t){
  switch((t||'').toLowerCase()){
    case 'hls': return 'HLS (.m3u8)';
    case 'dash': return 'DASH (.mpd)';
    default: return 'สตรีม';
  }
}

/* -------- Player -------- */
function cleanupPlayers(){
  try{
    if (hlsInstance){ hlsInstance.destroy(); hlsInstance = null; }
  }catch{}
  try{
    if (dashInstance){ dashInstance.reset(); dashInstance = null; }
  }catch{}
  try{
    videoEl.pause();
    videoEl.removeAttribute('src');
    videoEl.load();
  }catch{}
}

function openPlayer(ch){
  cleanupPlayers();
  modalTitle.textContent = ch.name || 'ช่องทีวี';
  metaEl.textContent = `${ch.category} • ${prettyType(ch.type)}`;

  const url = ch.src || ch.file || ch.url;
  const type = (ch.type || '').toLowerCase() || ( /\.m3u8/.test(url) ? 'hls' : /\.mpd/.test(url) ? 'dash' : 'auto' );

  if (type === 'hls' && window.Hls && Hls.isSupported()){
    hlsInstance = new Hls({enableWorker:true});
    hlsInstance.loadSource(url);
    hlsInstance.attachMedia(videoEl);
    hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => videoEl.play().catch(()=>{}));
  } else if (type === 'dash' && window.dashjs){
    dashInstance = dashjs.MediaPlayer().create();
    dashInstance.initialize(videoEl, url, true);
  } else {
    // fallback (Safari HLS native, หรือไฟล์ progressive)
    videoEl.src = url;
    videoEl.play().catch(()=>{});
  }

  modal.setAttribute('aria-hidden','false');
}

function closePlayer(){
  cleanupPlayers();
  modal.setAttribute('aria-hidden','true');
}

modal.addEventListener('click', e=>{
  if (e.target.hasAttribute('data-close')) closePlayer();
});
document.addEventListener('keydown', e=>{
  if (e.key === 'Escape' && modal.getAttribute('aria-hidden') === 'false') closePlayer();
});

/* -------- Search UX -------- */
qEl.addEventListener('input', render);
document.addEventListener('keydown', e=>{
  if (e.key === '/' && document.activeElement !== qEl){
    e.preventDefault(); qEl.focus();
  }
});

/* -------- Utils -------- */
function escapeHtml(s){
  return byStr(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* -------- Boot -------- */
loadChannels().catch(err=>{
  console.error(err);
  gridEl.innerHTML = `<p style="padding:14px;color:#fca5a5">โหลด channels.json ไม่สำเร็จ: ${escapeHtml(err.message||err)}</p>`;
});
