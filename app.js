/* FLOWTV – slim, smooth, cache-friendly
 * - ลบ Sub/Tip ออกจากการพึ่งพาใน JS
 * - เรนเดอร์แท็บ/รายการช่องแบบไหลลื่น
 * - รองรับ HLS/DASH และ ClearKey (ถ้ามีใน channels.json)
 * - เซฟช่องล่าสุด, เลื่อนเข้ากลางจอ, lazy-load รูป
 */
(() => {
  const TIMEZONE = 'Asia/Bangkok';
  const CHANNELS_URL = 'channels.json';
  const PLAYER_CONTAINER_ID = 'player';

  let channels = [];
  let activeCategory = 'ทั้งหมด';
  let filteredIdx = [];
  let player;

  // ---------- Utils ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const debounce = (fn, ms = 150) => {
    let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  };
  const proxify = (url) => {
    const base = (window.PROXY_BASE || '').trim();
    if (!base) return url;
    // encodeURIComponent ทั้ง URL ปลายทาง
    return `${base.replace(/\/+$/,'')}/p/${btoa(url)}`;
  };
  const isDash = (src, type) => type?.toLowerCase() === 'dash' || /\.mpd(\?|$)/i.test(src);
  const isHls  = (src, type) => type?.toLowerCase() === 'hls'  || /\.m3u8(\?|$)/i.test(src);

  // ---------- Clock + Now Playing ----------
  function mountClockAndNow() {
    const clockEl = $('#clock');
    if (clockEl) {
      const tick = () => {
        const now = new Date();
        clockEl.textContent = new Intl.DateTimeFormat('th-TH', {
          day:'2-digit', month:'short', year:'numeric',
          hour:'2-digit', minute:'2-digit', second:'2-digit',
          hour12:false, timeZone: TIMEZONE
        }).format(now).replace(',', '');
      };
      tick(); setInterval(tick, 1000);
    }
    // แนบ Now Playing แทน Sub เดิม
    if (clockEl && !$('#now-playing')) {
      const el = document.createElement('div');
      el.id = 'now-playing';
      el.className = 'now-playing';
      el.setAttribute('aria-live', 'polite');
      clockEl.after(el);
    }
  }
  function setNowPlaying(name = '') {
    const el = $('#now-playing'); if (!el) return;
    el.textContent = name || '';
    el.title = name || '';
    el.classList.remove('swap'); void el.offsetWidth; el.classList.add('swap');
  }

  // ---------- Tabs ----------
  function buildTabs(categories) {
    const nav = $('#tabs');
    nav.innerHTML = '';
    const makeBtn = (label) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tab';
      b.textContent = label;
      b.dataset.cat = label;
      if (label === activeCategory) b.classList.add('active');
      b.addEventListener('click', () => {
        setActiveCategory(label);
      });
      return b;
    };

    // ให้มี "ทั้งหมด" ไว้ตัวแรกเสมอ
    const uniq = ['ทั้งหมด', ...[...new Set(categories)].filter(c => c && c !== 'ทั้งหมด')];
    uniq.forEach(c => nav.appendChild(makeBtn(c)));

    // เลื่อนแท็บให้อยู่กลางเมื่อเปลี่ยน
    const centerTabs = () => {
      const active = $('.tab.active', nav);
      if (!active) return;
      const left = active.offsetLeft - (nav.clientWidth - active.clientWidth) / 2;
      nav.scrollTo({ left, behavior: 'smooth' });
    };
    centerTabs();
    addEventListener('resize', debounce(centerTabs, 150));
  }
  function setActiveCategory(cat) {
    activeCategory = cat;
    $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.cat === cat));
    renderGrid();
  }

  // ---------- Grid ----------
  let logoObserver;
  function ensureLogoObserver() {
    if (logoObserver) return;
    logoObserver = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          const img = e.target;
          if (img.dataset.src && !img.src) img.src = img.dataset.src;
          logoObserver.unobserve(img);
        }
      }
    }, { rootMargin: '300px 0px' });
  }
  function renderGrid() {
    const wrap = $('#channel-list');
    wrap.innerHTML = '';

    const list = channels.map((ch, i) => ({ ch, i }))
      .filter(({ ch }) => (activeCategory === 'ทั้งหมด' ? true : (ch.category || 'อื่นๆ') === activeCategory));

    filteredIdx = list.map(x => x.i);

    const frag = document.createDocumentFragment();
    ensureLogoObserver();

    list.forEach(({ ch, i }) => {
      const card = document.createElement('article');
      card.className = 'channel';
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.dataset.index = i;

      card.innerHTML = `
        <div class="thumb">
          <img class="logo" alt="${escapeHtml(ch.name || '')}" loading="lazy" decoding="async" />
        </div>
        <div class="meta">
          <div class="name ellipsis" title="${escapeHtml(ch.name || '')}">${escapeHtml(ch.name || '')}</div>
          <div class="tags">
            ${badge(ch.category || 'ทั่วไป')}
            ${badge(isDash(ch.src, ch.type) ? 'DASH' : (isHls(ch.src, ch.type) ? 'HLS' : 'AUTO'))}
          </div>
        </div>
      `;

      const img = $('.logo', card);
      img.dataset.src = (ch.logo || '').trim();
      if (img.dataset.src) logoObserver.observe(img);

      card.addEventListener('click', () => play(i));
      card.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); play(i); }
      });

      frag.appendChild(card);
    });

    wrap.appendChild(frag);
  }
  function badge(text) {
    return `<span class="badge">${escapeHtml(text)}</span>`;
  }
  function escapeHtml(s='') {
    return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  }

  // ---------- Player ----------
  function setupPlayerIfNeeded() {
    if (player) return player;
    if (!window.jwplayer) {
      const holder = document.createElement('div');
      holder.style.color = '#fff'; holder.style.padding = '16px';
      holder.textContent = 'JW Player ไม่พร้อมใช้งาน';
      $(PLAYER_CONTAINER_ID.startsWith('#')?PLAYER_CONTAINER_ID:'#'+PLAYER_CONTAINER_ID)?.appendChild(holder);
      return null;
    }
    player = jwplayer(PLAYER_CONTAINER_ID);
    return player;
  }

  function play(index, opts = { scroll: true }) {
    index = Math.max(0, Math.min(channels.length - 1, index));
    const ch = channels[index] || {};
    const file = proxify(ch.src || '');
    if (!file) return;

    const cfg = {
      autostart: true,
      preload: 'auto',
      width: '100%',
      aspectratio: '16:9',
      playbackRateControls: true,
      controls: true,
      // ให้แหล่งเดียวแบบเจาะชนิด เพื่อหลีกเลี่ยงสลับผิด
      sources: [{
        file,
        type: isDash(ch.src, ch.type) ? 'dash' : (isHls(ch.src, ch.type) ? 'hls' : undefined)
      }]
    };

    // DRM — ClearKey (ถ้ามี)
    if (ch.drm?.clearkey?.key && ch.drm?.clearkey?.keyId) {
      cfg.drm = { clearkey: { keyId: ch.drm.clearkey.keyId, key: ch.drm.clearkey.key } };
    }

    const p = setupPlayerIfNeeded();
    if (!p) return;

    p.setup(cfg);

    // UI state
    setNowPlaying(ch.name || '');
    localStorage.setItem('lastIndex', String(index));

    highlightActiveCard(index);
    if (opts.scroll !== false) scrollCardIntoView(index);

    // กันกรณีเล่นล้มเหลว
    p.on('error', e => {
      console.error('JW Error:', e);
      setNowPlaying((ch.name || '') + ' • เล่นไม่สำเร็จ');
    });
  }

  function highlightActiveCard(index) {
    $$('.channel').forEach(el => el.classList.remove('active'));
    const el = $(`.channel[data-index="${index}"]`);
    if (el) el.classList.add('active');
  }
  function scrollCardIntoView(index) {
    const el = $(`.channel[data-index="${index}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  }

  // ---------- Keyboard next/prev ----------
  addEventListener('keydown', (e) => {
    if (!channels.length) return;
    if (['ArrowRight','ArrowDown','PageDown'].includes(e.key)) {
      e.preventDefault();
      const cur = parseInt(localStorage.getItem('lastIndex') || '0', 10);
      const pool = filteredIdx.length ? filteredIdx : channels.map((_,i)=>i);
      const pos = Math.max(0, pool.indexOf(cur));
      const next = pool[(pos + 1) % pool.length];
      play(next);
    } else if (['ArrowLeft','ArrowUp','PageUp'].includes(e.key)) {
      e.preventDefault();
      const cur = parseInt(localStorage.getItem('lastIndex') || '0', 10);
      const pool = filteredIdx.length ? filteredIdx : channels.map((_,i)=>i);
      const pos = Math.max(0, pool.indexOf(cur));
      const prev = pool[(pos - 1 + pool.length) % pool.length];
      play(prev);
    }
  });

  // ---------- Init ----------
  function init() {
    mountClockAndNow();

    fetch(CHANNELS_URL)              // ให้เบราว์เซอร์จัดการแคช (ลื่นกว่า no-store)
      .then(r => r.json())
      .then(data => {
        channels = Array.isArray(data) ? data : (data.channels || []);
        const categories = channels.map(c => c.category || 'ทั่วไป');
        buildTabs(categories);

        renderGrid();

        // เริ่มเล่นจากช่องล่าสุด (ถ้ามี)
        let start = parseInt(localStorage.getItem('lastIndex') || '0', 10);
        if (!(start >= 0 && start < channels.length)) start = 0;
        if (channels.length) play(start, { scroll: false });
      })
      .catch(err => {
        console.error('โหลด channels.json ไม่สำเร็จ:', err);
        const grid = $('#channel-list');
        if (grid) grid.innerHTML = `<div class="empty">โหลดรายการช่องไม่สำเร็จ</div>`;
      });
  }

  // เริ่ม!
  addEventListener('DOMContentLoaded', init);
})();
