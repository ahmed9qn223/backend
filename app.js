/* FLOWTV – ไม่มีระบบกรอง/แท็บ ตามคำขอ
 * - เปลี่ยนหมวด "ข่าว" -> "IPTV" (ถ้ามาในข้อมูล)
 * - เพิ่มการเดาหมวด "เด็ก" (เพื่อแสดง badge ถูกต้อง)
 * - แสดงทุกช่องในกริดเดียว รองรับมือถือ/คอม
 */

const gridEl = document.getElementById('grid');
const modal = document.getElementById('playerModal');
const modalTitle = document.getElementById('playerTitle');
const metaEl = document.getElementById('meta');
const videoEl = document.getElementById('player');

let channels = [];
let hlsInstance = null;
let dashInstance = null;

const byStr = v => (v || '').toString();

/* ---------- Data loading ---------- */
function flattenOne(arr){
  if (!Array.isArray(arr)) return arr;
  if (!arr.some(Array.isArray)) return arr;
  return arr.reduce((acc, item) => acc.concat(item), []);
}

async function loadChannels(){
  const res = await fetch('channels.json', {cache:'no-store'});
  const data = await res.json();

  let list = Array.isArray(data) ? data : (data.channels || []);
  list = flattenOne(list);

  channels = list
    .filter(x => x && typeof x === 'object')
    .map((ch, idx) => {
      const src = byStr(ch.src || ch.file || ch.url);
      const name = byStr(ch.name || `ช่อง #${idx+1}`);
      const logo = byStr(ch.logo || '');
      let category = byStr(ch.category).trim();
      if (category === 'ข่าว') category = 'IPTV';        // rename ตรงนี้
      if (!category) category = guessCategory({name, logo, src});

      // type: auto-detect
      let type = byStr(ch.type).toLowerCase();
      if (!type){
        if (/\.m3u8($|\?)/.test(src)) type = 'hls';
        else if (/\.mpd($|\?)/.test(src)) type = 'dash';
        else type = 'auto';
      }
      return { ...ch, name, logo, src, category, type };
    });

  renderAll();
}

/* ---------- Category guess ---------- */
function guessCategory(ch){
  const name = `${byStr(ch.name)} ${byStr(ch.logo)}`.toLowerCase();
  const src  = byStr(ch.src || ch.file || ch.url).toLowerCase();

  // หนัง
  if (/(^|\s)(hbo|cinemax|mono\s?29\s?plus|movie|movies|film|true\s?film|signature|hits|family)(\s|$)/.test(name)) return 'หนัง';
  if (/\.mp4($|\?)/.test(src)) return 'หนัง';

  // IPTV (เดิม "ข่าว")
  if (/(ข่าว|tnn|nation|thairath|nbt|pbs|jkn|workpoint\s?news)/.test(name)) return 'IPTV';

  // เด็ก
  if (/(kid|เด็ก|cartoon|toon|junior|nick|animax|dreamworks|pbskids|zoo\s?moo|boomerang|baby|disney)/.test(name)) return 'เด็ก';

  // กีฬา / สารคดี / เพลง
  if (/(sport|กีฬา|bein|true\s?sport|pptv\s?hd\s?36|tsports?)/.test(name)) return 'กีฬา';
  if (/(สารคดี|discovery|animal|nat.?geo|history|documentary|bbc\s?earth)/.test(name)) return 'สารคดี';
  if (/(เพลง|music|mtv|channel\s?v|music\s?hits)/.test(name)) return 'เพลง';

  return 'บันเทิง';
}

/* ---------- Render (all channels, no filter) ---------- */
function renderAll(){
  gridEl.innerHTML = '';

  if (!channels.length){
    gridEl.innerHTML = `<p style="padding:14px;color:#fca5a5">ไม่พบช่องใน channels.json</p>`;
    return;
  }

  for (const ch of channels){
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
      <span class="badge">${ch.category || 'ทั่วไป'}</span>
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

/* ---------- Player ---------- */
function cleanupPlayers(){
  try{ if (hlsInstance){ hlsInstance.destroy(); hlsInstance = null; } }catch{}
  try{ if (dashInstance){ dashInstance.reset(); dashInstance = null; } }catch{}
  try{
    videoEl.pause();
    videoEl.removeAttribute('src');
    videoEl.load();
  }catch{}
}

function openPlayer(ch){
  cleanupPlayers();
  modalTitle.textContent = ch.name || 'ช่องทีวี';
  metaEl.textContent = `${ch.category || 'ทั่วไป'} • ${prettyType(ch.type)}`;

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
    videoEl.src = url;  // Safari HLS native หรือ progressive
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

/* ---------- Utils ---------- */
function escapeHtml(s){
  return byStr(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* ---------- Boot ---------- */
loadChannels().catch(err=>{
  console.error(err);
  gridEl.innerHTML = `<p style="padding:14px;color:#fca5a5">โหลด channels.json ไม่สำเร็จ: ${escapeHtml(err.message||err)}</p>`;
});
