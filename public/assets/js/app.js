'use strict';
const API = '/api';
const $ = (s, c = document) => c.querySelector(s);
const $$ = (s, c = document) => [...c.querySelectorAll(s)];
const content = $('#page-content');
const toastEl = $('#toast');
const K = { settings: 'komikmu:settings', recent: 'komikmu:recent', bm: 'komikmu:bookmarks', searches: 'komikmu:searches' };

const esc = (v = '') => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const slugPath = v => encodeURIComponent(String(v || '').trim());
const labelize = v => String(v || '').replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
const keyOf = s => String(s || '').split('?')[0].replace(/\/+$/, '').split('/').pop();
const ic = (n, cls = '') => `<svg class="ic ${cls}" aria-hidden="true"><use href="#i-${n}"/></svg>`;

const store = {
  get(k, fb) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch { return fb; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {  } }
};

const settings = Object.assign({ theme: 'dark', motion: true, fullscreen: true, name: 'Pengunjung', avatar: '', read: 0 }, store.get(K.settings, {}));
const saveSettings = () => store.set(K.settings, settings);
const resolvedTheme = () => settings.theme === 'auto' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : settings.theme;
function applyTheme() {
  const t = resolvedTheme();
  document.documentElement.dataset.theme = t;
  document.documentElement.dataset.motion = settings.motion === false ? 'off' : 'on';
  $('meta[name=theme-color]')?.setAttribute('content', t === 'light' ? '#ffffff' : '#000000');
  $$('[data-act=theme]').forEach(b => b.setAttribute('aria-checked', String(t === 'dark')));
}
applyTheme();

let toastTimer;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
}

const memCache = new Map();
async function api(path, { fresh = false } = {}) {
  const hit = memCache.get(path);
  if (hit && !fresh && Date.now() - hit.t < 120000) return hit.d;
  let res;
  try { res = await fetch(`${API}${path}`, { headers: { Accept: 'application/json' } }); }
  catch { throw new Error('Tidak dapat terhubung ke server Komik Mu. Periksa koneksi atau server.'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) throw new Error(data.error || `Permintaan gagal (${res.status}).`);
  if (!fresh) {
    memCache.set(path, { t: Date.now(), d: data });
    if (memCache.size > 60) memCache.delete(memCache.keys().next().value);
  }
  return data;
}

const known = new Map();
function remember(item) {
  const slug = item.slug || item.url || '';
  const key = keyOf(slug);
  if (!key) return null;
  const rec = { key, slug, title: item.title || 'Komik', thumbnail: item.thumbnail || '' };
  known.set(key, rec);
  return rec;
}
const getBookmarks = () => store.get(K.bm, []);
const isBookmarked = key => getBookmarks().some(b => b.key === key);
function toggleBookmark(key) {
  const list = getBookmarks();
  const i = list.findIndex(b => b.key === key);
  if (i >= 0) { list.splice(i, 1); store.set(K.bm, list); toast('Dihapus dari bookmark'); return syncBookmarks(key); }
  const rec = known.get(key);
  if (!rec) return;
  list.unshift({ ...rec, time: Date.now() });
  store.set(K.bm, list.slice(0, 200));
  toast('Ditambahkan ke bookmark');
  syncBookmarks(key, true);
}
function syncBookmarks(key, pop) {
  const on = isBookmarked(key);
  $$('[data-act=bm]').forEach(b => {
    if (b.dataset.key !== key) return;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
    if (b.classList.contains('btn')) { const l = $('span', b); if (l) l.textContent = on ? 'Tersimpan' : 'Bookmark'; }
    if (pop) { b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop'); }
  });
  if (currentRoute?.name === 'bookmark') renderBookmarks();
}
const getRecent = () => store.get(K.recent, []);
const comicKey = r => keyOf(r.slug) || keyOf(r.chapterSlug);
function recentComics() {
  const seen = new Set();
  return getRecent().filter(r => { const k = comicKey(r); if (seen.has(k)) return false; seen.add(k); return true; });
}
function saveRecent(chapter, detail) {
  try {
    const list = getRecent();
    const rec = {
      title: detail?.title || chapter.title || 'Komik', slug: detail?.slug || '', thumbnail: detail?.thumbnail || '',
      chapterSlug: chapter.slug, chapterTitle: chapter.title || 'Lanjutkan membaca', time: Date.now()
    };
    const existed = list.some(r => keyOf(r.chapterSlug) === keyOf(rec.chapterSlug));
    store.set(K.recent, [rec, ...list.filter(r => keyOf(r.chapterSlug) !== keyOf(rec.chapterSlug))].slice(0, 60));
    if (!existed) { settings.read = (settings.read || 0) + 1; saveSettings(); }
  } catch {  }
}
function timeAgo(t) {
  const s = Math.max(1, (Date.now() - t) / 1000);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} menit lalu`;
  if (s < 86400) return `${Math.round(s / 3600)} jam lalu`;
  if (s < 2592000) return `${Math.round(s / 86400)} hari lalu`;
  return `${Math.round(s / 2592000)} bulan lalu`;
}

const thumb = u => /^https?:/i.test(u || '') ? `/img?u=${encodeURIComponent(u)}` : (u || '');
const imageQueue = [];
const imageQueued = new WeakSet();
let activeImages = 0;
const MAX_ACTIVE_IMAGES = 4;
function queueImage(img) {
  if (!img || img.dataset.src === undefined || imageQueued.has(img)) return;
  imageQueued.add(img);
  imageQueue.push(img);
  pumpImages();
}
function pumpImages() {
  while (activeImages < MAX_ACTIVE_IMAGES && imageQueue.length) {
    const img = imageQueue.shift();
    if (!img.isConnected || img.dataset.src === undefined) continue;
    const src = img.dataset.src;
    delete img.dataset.src;
    activeImages++;
    const done = () => {
      activeImages = Math.max(0, activeImages - 1);
      pumpImages();
    };
    img.addEventListener('load', done, { once: true });
    img.addEventListener('error', done, { once: true });
    img.src = src;
  }
}
let imageObserver;
if ('IntersectionObserver' in window) {
  imageObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      imageObserver.unobserve(entry.target);
      queueImage(entry.target);
    });
  }, { rootMargin: '320px 0px', threshold: 0.01 });
}
function observeDeferredImages(root = document) {
  root.querySelectorAll('img[data-src]').forEach(img => {
    if (imageObserver) imageObserver.observe(img);
    else queueImage(img);
  });
}
const deferredImageMutation = new MutationObserver(records => {
  records.forEach(record => record.addedNodes.forEach(node => {
    if (node.nodeType !== 1) return;
    if (node.matches?.('img[data-src]')) {
      if (imageObserver) imageObserver.observe(node); else queueImage(node);
    }
    observeDeferredImages(node);
  }));
});
if (content) deferredImageMutation.observe(content, { childList: true, subtree: true });
function imgFail(img) {
  const alt = img.dataset.alt;
  if (alt) { img.dataset.alt = ''; img.src = alt; }
  else if (img.dataset.keep !== undefined) img.classList.add('image-error', 'ld');
  else img.remove();
}

function coverImg(src, title, eager) {
  const s = thumb(src);
  return `<span class="ph">K</span>${src ? `<img ${eager ? `src="${esc(s)}" fetchpriority="high" loading="eager"` : `data-src="${esc(s)}" loading="lazy"`} ${s !== src ? `data-alt="${esc(src)}"` : ''} alt="Sampul ${esc(title)}" decoding="async" referrerpolicy="no-referrer" onerror="imgFail(this)">` : ''}`;
}
function bmBtn(key) {
  const on = isBookmarked(key);
  return `<button class="bm ${on ? 'on' : ''}" data-act="bm" data-key="${esc(key)}" aria-pressed="${on}" aria-label="Bookmark">${ic('bookmark')}</button>`;
}
function cardMarkup(item, i = 0) {
  const rec = remember(item);
  const title = item.title || 'Judul belum tersedia';
  const href = rec ? `#detail/${slugPath(rec.slug)}` : '#home';
  const genre = item.genre && item.genre !== title ? item.genre : '';
  const ch = item.total_chapters || '';
  return `<article class="card" style="--i:${Math.min(i, 14)}">
    <a class="cover" href="${href}" aria-label="Buka ${esc(title)}">${coverImg(item.thumbnail, title, i < 8)}${ch ? `<span class="badge">${esc(ch)}</span>` : ''}</a>
    ${rec ? bmBtn(rec.key) : ''}
    <a class="card-title" href="${href}">${esc(title)}</a>
    <div class="card-meta">${esc(genre || 'Komik')}</div>
  </article>`;
}
const gridMarkup = items => `<div class="grid">${items.map(cardMarkup).join('')}</div>`;
const skelGrid = (n = 12) => `<div class="grid">${Array.from({ length: n }, () => '<div class="card skel"><div class="cover sk"></div><i class="sk"></i><i class="sk"></i></div>').join('')}</div>`;
const skelHead = () => '<div class="sk sk-line" style="width:40%;height:28px;margin-bottom:22px"></div>';
const emptyMarkup = (icon, title, text, action = '') => `<div class="empty"><div class="big">${ic(icon)}</div><h3>${esc(title)}</h3><p>${esc(text)}</p>${action}</div>`;
const pageHead = (title, sub, right = '') => `<div class="page-head"><div><h1>${esc(title)}</h1>${sub ? `<p>${esc(sub)}</p>` : ''}</div>${right}</div>`;
const sectionHead = (title, link = '', label = 'Lihat Semua') => `<div class="section-head"><h2>${esc(title)}</h2>${link ? `<a class="link" href="${esc(link)}">${label} ${ic('chev-r')}</a>` : ''}</div>`;

function rowMarkup(item, i = 0) {
  const rec = remember(item);
  if (!rec) return '';
  const href = `#detail/${slugPath(rec.slug)}`;
  const genre = item.genre && item.genre !== item.title ? item.genre : '';
  return `<article class="row" style="--i:${Math.min(i, 12)}">
    <a class="row-cover" href="${href}">${coverImg(item.thumbnail, rec.title)}</a>
    <div class="row-body"><a class="row-title" href="${href}">${esc(rec.title)}</a>
      <div class="row-tags">${genre ? `<span class="chip mini">${esc(genre)}</span>` : ''}${item.total_chapters ? `<span class="chip mini">${esc(item.total_chapters)}</span>` : ''}</div></div>
    <div class="row-end">${bmBtn(rec.key)}<a class="btn primary sm" href="${href}">Baca</a></div>
  </article>`;
}

function paginationMarkup(page, base, hasNext) {
  const join = base.includes('?') ? '&' : '?';
  const link = (n, label, cls = '') => `<a class="pg ${cls}" href="${esc(base)}${join}page=${n}" ${label === String(n) ? '' : `aria-label="Halaman ${n}"`}>${label}</a>`;
  const nums = [];
  for (let n = Math.max(1, page - 2); n <= page + (hasNext ? 1 : 0); n++) nums.push(n === page ? `<span class="pg cur" aria-current="page">${n}</span>` : link(n, String(n)));
  return `<nav class="pagination" aria-label="Paginasi">${page > 1 ? link(page - 1, '‹') : '<span class="pg off">‹</span>'}${nums.join('')}${hasNext ? link(page + 1, '›') : '<span class="pg off">›</span>'}</nav>`;
}

function setContent(html, still = false) {
  content.innerHTML = html;
  content.classList.toggle('still', still);
  if (!still) { content.classList.remove('enter'); void content.offsetWidth; content.classList.add('enter'); }
}
function swr(path, loader, paint, t) {
  const ck = 'komikmu:c:' + path;
  const cached = store.get(ck, null);
  if (cached) paint(cached, false);
  return loader(!!cached).then(data => {
    if (t !== token) return;
    if (!cached) paint(data, false);
    else if (JSON.stringify(data) !== JSON.stringify(cached)) paint(data, true);
    const idx = store.get('komikmu:cidx', []).filter(k => k !== ck);
    idx.push(ck);
    while (idx.length > 12) { try { localStorage.removeItem(idx.shift()); } catch {} }
    store.set('komikmu:cidx', idx);
    store.set(ck, data);
  }).catch(err => { if (!cached) throw err; });
}
let modalDone = null;
function confirmDialog(title, text, ok = 'Ya, hapus') {
  return new Promise(res => {
    const m = $('#modal');
    m.innerHTML = `<div class="modal-card" role="alertdialog" aria-modal="true"><h3>${esc(title)}</h3><p>${esc(text)}</p><div class="modal-actions"><button class="btn" data-m="no">Batal</button><button class="btn primary" data-m="yes">${esc(ok)}</button></div></div>`;
    m.hidden = false;
    const done = v => { m.hidden = true; m.innerHTML = ''; m.onclick = null; modalDone = null; res(v); };
    modalDone = done;
    m.onclick = e => { if (e.target === m) return done(false); const b = e.target.closest('[data-m]'); if (b) done(b.dataset.m === 'yes'); };
  });
}
function showError(error) {
  setContent(`<section class="error-box"><div class="big">!</div><h2>Belum dapat memuat halaman</h2><p>${esc(error?.message || 'Terjadi masalah yang tidak diketahui.')}</p><button class="btn primary" data-act="retry">Coba lagi</button></section>`);
}

let genres = [];
const genresReady = api('/genres').then(d => { genres = d.genres || []; return genres; }).catch(() => []);
const genreChips = (list = genres, cls = '') => list.map(g => `<a class="chip ${cls}" href="#genre/${slugPath(g)}">${esc(labelize(g))}</a>`).join('');

const SIDE = new Set(['latest', 'popular', 'type', 'genre', 'search', 'kategori', 'bookmark', 'riwayat', 'profil', 'bantuan', 'tentang']);
let currentRoute = null, lastRouteKey = '', token = 0, cleanup = null;

function routeInfo() {
  const raw = (location.hash || '#home').replace(/^#/, '');
  const [rawPath, rawQuery = ''] = raw.split('?');
  const seg = rawPath.split('/').filter(Boolean).map(s => { try { return decodeURIComponent(s); } catch { return s; } });
  const params = new URLSearchParams(rawQuery);
  const page = Math.max(1, Math.min(500, Number.parseInt(params.get('page') || '1', 10) || 1));
  const rest = seg.slice(1).join('/');
  switch (seg[0]) {
    case 'search': return { name: 'search', q: rest || params.get('q') || '', page, key: `search:${rest}:${page}` };
    case 'type': return { name: 'type', type: seg[1] || 'manhwa', page, key: `type:${seg[1]}:${page}` };
    case 'genre': return { name: 'genre', genre: seg[1] || '', page, key: `genre:${seg[1]}:${page}` };
    case 'detail': return { name: 'detail', slug: rest, key: `detail:${rest}` };
    case 'chapter': return { name: 'chapter', slug: rest, key: `chapter:${rest}` };
    case 'latest': case 'jelajah': return { name: 'latest', page, key: `latest:${page}` };
    case 'popular': return { name: 'popular', page, key: `popular:${page}` };
    case 'kategori': case 'bookmark': case 'riwayat': case 'profil': case 'tentang': return { name: seg[0], key: seg[0] };
    case 'bantuan': return { name: 'bantuan', faq: seg[1] === 'faq', key: `bantuan:${seg[1] || ''}` };
    default: return { name: 'home', key: 'home' };
  }
}
function navKeys(r) {
  if (['latest', 'popular', 'genre', 'search', 'kategori'].includes(r.name)) return ['jelajah'];
  if (r.name === 'type') return ['jelajah', `type/${r.type}`];
  if (['bantuan', 'tentang'].includes(r.name)) return ['profil'];
  return [r.name];
}
function setView(r) {
  document.body.dataset.view = r.name === 'chapter' ? 'chapter' : r.name;
  document.body.dataset.side = SIDE.has(r.name) ? '1' : '0';
  const keys = navKeys(r);
  $$('[data-nav]').forEach(a => {
    const on = keys.includes(a.dataset.nav);
    a.classList.toggle('active', on);
    on ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current');
  });
}

async function renderRoute(force = false) {
  const route = routeInfo();
  if (!force && route.key === lastRouteKey) return;
  lastRouteKey = route.key;
  currentRoute = route;
  token++;
  cleanup?.(); cleanup = null;
  closeOverlays();
  setView(route);
  window.scrollTo(0, 0);
  try {
    switch (route.name) {
      case 'home': await renderHome(); break;
      case 'latest': case 'popular': case 'type': case 'genre': await renderCollection(route); break;
      case 'search':
        if (!route.q.trim()) { location.hash = '#latest'; return; }
        await renderCollection(route); break;
      case 'detail': await renderDetail(route); break;
      case 'chapter': await renderChapter(route); break;
      case 'kategori': await renderKategori(); break;
      case 'bookmark': renderBookmarks(); break;
      case 'riwayat': renderRiwayat(); break;
      case 'profil': renderProfil(); break;
      case 'bantuan': renderBantuan(route); break;
      case 'tentang': renderTentang(); break;
    }
  } catch (error) {
    if (route === currentRoute) showError(error);
  }
}

async function renderHome() {
  const t = token;
  setContent(`<section class="hero" id="hero">
      <img class="hero-img" id="hero-img" alt="" referrerpolicy="no-referrer" hidden>
      <div class="hero-body">
        <div class="hero-tag">${ic('book')} Ruang baca kamu</div>
        <h1>Komik <span>Mu</span></h1>
        <p>Baca Komik Favoritmu<br>Kapan Saja, Di Mana Saja</p>
        <form class="field" data-search>${ic('search')}<input type="search" placeholder="Cari judul komik, author, atau genre..." autocomplete="off" aria-label="Cari komik"><button class="go" type="submit">Cari</button></form>
        <div class="hero-actions"><a class="btn primary" href="#latest">Mulai Membaca ${ic('arrow-r')}</a><button class="btn" data-act="random">${ic('shuffle')} Komik Acak</button></div>
      </div></section>
    <div id="home-body">${skelHead()}${skelGrid(6)}${skelHead()}${skelGrid(6)}</div>`);
  const loader = async fresh => {
    const d = await api('/home', { fresh });
    if (!(d.popular || []).length) { try { d.popular = (await api('/popular?page=1')).items || []; } catch { d.popular = []; } }
    return d;
  };
  const paint = (data, still) => {
    if (t !== token || !$('#home-body')) return;
    content.classList.toggle('still', !!still);
    const popular = data.popular || [];
    const latest = data.latest || data.items?.slice(0, 20) || [];
    const hero = [...popular, ...latest].find(i => i.thumbnail);
    const hi = $('#hero-img');
    if (hero && hi && hi.dataset.o !== hero.thumbnail) {
      hi.hidden = false;
      hi.classList.remove('ld');
      hi.onload = () => hi.classList.add('ld');
      hi.onerror = () => {
        if (!hi.dataset.f && thumb(hero.thumbnail) !== hero.thumbnail) {
          hi.dataset.f = '1';
          hi.src = hero.thumbnail;
        } else {
          hi.hidden = true;
        }
      };
      hi.fetchPriority = 'high';
      hi.loading = 'eager';
      hi.decoding = 'async';
      hi.src = thumb(hero.thumbnail);
      hi.dataset.o = hero.thumbnail;
      hi.dataset.f = '';
    }
    const recents = recentComics().slice(0, 6);
    const cont = recents.length ? `<section class="section">${sectionHead('Lanjutkan Membaca', '#riwayat', 'Riwayat')}<div class="list two">${recents.slice(0, 2).map(historyRow).join('')}</div></section>` : '';
    $('#home-body').innerHTML = `${cont}
      <section class="section">${sectionHead('Komik Populer', '#popular')}${popular.length ? gridMarkup(popular.slice(0, 12)) : emptyMarkup('book', 'Belum ada data', 'Daftar populer belum tersedia dari sumber.')}</section>
      <section class="section">${sectionHead('Update Terbaru', '#latest')}${latest.length ? gridMarkup(latest.slice(0, 18)) : emptyMarkup('book', 'Belum ada data', 'Update terbaru belum tersedia dari sumber.')}</section>
      <section class="section">${sectionHead('Jelajahi Genre', '#kategori')}<div class="chips" id="home-genres"></div></section>`;
    genresReady.then(g => { const el = $('#home-genres'); if (el && t === token) el.innerHTML = genreChips(g.slice(0, 18)); });
  };
  await swr('/home', loader, paint, t);
}

async function renderCollection(route) {
  const t = token;
  const tabs = [['Semua', '#latest', ['latest', 'popular']], ['Manga', '#type/manga', 'manga'], ['Manhwa', '#type/manhwa', 'manhwa'], ['Manhua', '#type/manhua', 'manhua']];
  const base = { latest: '#latest', popular: '#popular', type: `#type/${route.type}`, genre: `#genre/${route.genre}`, search: `#search/${slugPath(route.q)}` }[route.name];
  const isBrowse = ['latest', 'popular', 'type'].includes(route.name);
  const tabsHtml = `<div class="tabs" role="tablist">${tabs.map(([l, h, m]) => {
    const on = Array.isArray(m) ? m.includes(route.name) : route.type === m && route.name === 'type';
    return `<a class="chip ${on ? 'on' : ''}" href="${h}" role="tab" aria-selected="${on}">${l}</a>`;
  }).join('')}</div>`;
  const sort = route.name === 'latest' || route.name === 'popular'
    ? `<div class="seg" role="group" aria-label="Urutkan"><a class="${route.name === 'latest' ? 'on' : ''}" href="#latest">Terbaru</a><a class="${route.name === 'popular' ? 'on' : ''}" href="#popular">Populer</a></div>` : '';
  const headFor = n => {
    if (route.name === 'search') return `${pageHead('Hasil Pencarian')}<form class="field" data-search style="margin-bottom:12px">${ic('search')}<input type="search" value="${esc(route.q)}" autocomplete="off" aria-label="Cari komik"><button class="go" type="submit">Cari</button></form><p class="muted" style="margin-bottom:20px;font-size:13px">Menampilkan hasil untuk <strong>“${esc(route.q)}”</strong>${n != null ? ` · ${n} hasil` : ''}</p>`;
    if (route.name === 'genre') return `${pageHead(`Genre ${labelize(route.genre)}`, `Komik dengan genre ${labelize(route.genre)}`, `<a class="link" href="#kategori">Semua genre ${ic('chev-r')}</a>`)}`;
    return `${pageHead('Jelajah Komik', route.name === 'type' ? `Koleksi ${route.type} yang tersedia` : 'Temukan komik favoritmu dari berbagai genre')}<div class="toolbar">${tabsHtml}${sort}</div>`;
  };
  setContent(`${headFor(null)}${route.name === 'search' ? '<div class="list">' + Array.from({ length: 5 }, () => '<div class="sk" style="height:84px;border-radius:14px"></div>').join('') + '</div>' : skelGrid(12)}`);
  const q = `?page=${route.page}`;
  const path = { latest: `/latest${q}`, popular: `/popular${q}`, type: `/type/${slugPath(route.type)}${q}`, genre: `/genre/${slugPath(route.genre)}${q}`, search: `/search?q=${encodeURIComponent(route.q)}&page=${route.page}` }[route.name];
  const paint = (data, still) => {
    if (t !== token) return;
    const items = (route.name === 'search' ? data.results : data.items) || [];
    const body = !items.length
      ? emptyMarkup('search', route.page > 1 ? 'Sudah di ujung daftar' : 'Tidak ada hasil', route.name === 'search' ? 'Coba kata kunci lain atau periksa penulisan judulnya.' : 'Belum ada komik yang bisa ditampilkan di sini.', route.page > 1 ? `<a class="btn primary" href="${esc(base)}">Kembali ke halaman 1</a>` : '')
      : route.name === 'search' ? `<div class="list">${items.map(rowMarkup).join('')}</div>` : gridMarkup(items);
    setContent(`${headFor(items.length)}${body}${items.length || route.page > 1 ? paginationMarkup(route.page, base, items.length > 0) : ''}`, still);
  };
  if (route.name !== 'search' && route.page === 1) await swr(path, f => api(path, { fresh: f }), paint, t);
  else { const data = await api(path); paint(data, false); }
}

async function renderKategori() {
  const t = token;
  const cats = [['Manga', 'manga', '#3d3d3d', '#0d0d0d'], ['Manhwa', 'manhwa', '#2b2b2b', '#080808'], ['Manhua', 'manhua', '#4c4c4c', '#141414']];
  setContent(`${pageHead('Kategori', 'Pilih kategori yang kamu suka')}
    <div class="cat-grid section">${cats.map(([n, s, a, b], i) => `<a class="cat" style="--c1:${a};--c2:${b};--i:${i}" href="#type/${s}">${ic('layers')}<strong>${n}</strong><span>Jelajahi koleksi ${s}</span></a>`).join('')}</div>
    <section class="section">${sectionHead('Genre Populer')}<div class="chips" id="kat-genres"></div></section>
    <section class="section">${sectionHead('Komik Terpopuler', '#popular')}<div id="kat-pop">${skelGrid(6)}</div></section>`);
  genresReady.then(g => { const el = $('#kat-genres'); if (el && t === token) el.innerHTML = genreChips(g); });
  const d = await api('/popular?page=1');
  if (t !== token) return;
  $('#kat-pop').innerHTML = d.items?.length ? gridMarkup(d.items.slice(0, 12)) : emptyMarkup('book', 'Belum ada data', 'Daftar populer belum tersedia.');
}

async function renderDetail(route) {
  const t = token;
  setContent(`<div class="sk sk-block" style="height:260px"></div><div class="sk sk-line" style="width:60%;height:30px"></div><div class="sk sk-line" style="width:90%"></div><div class="sk sk-line" style="width:80%"></div>`);
  const item = await api(`/detail?slug=${encodeURIComponent(route.slug)}`);
  if (t !== token) return;
  remember({ slug: item.slug || route.slug, title: item.title, thumbnail: item.thumbnail });
  const key = keyOf(item.slug || route.slug);
  const title = item.title || 'Judul tidak diketahui';
  const chapters = item.chapters || [];
  const last = recentComics().find(r => keyOf(r.slug) === key) && getRecent().find(r => keyOf(r.slug) === key);
  const readKeys = new Set(getRecent().filter(r => keyOf(r.slug) === key).map(r => keyOf(r.chapterSlug)));
  const first = item.first_chapter, latest = item.latest_chapter;
  const hrefOf = c => `#chapter/${slugPath(c.slug || c.url)}`;
  const main = last ? `<a class="btn primary" href="#chapter/${slugPath(last.chapterSlug)}">${ic('play')} Lanjutkan Baca</a>`
    : first || latest ? `<a class="btn primary" href="${hrefOf(first || latest)}">${ic('play')} Baca Sekarang</a>` : '';
  const saved = isBookmarked(key);
  const genreChipsHtml = (item.genres || []).map(g => `<a class="chip mini" href="#genre/${slugPath(g.slug)}">${esc(g.name)}</a>`).join('');
  const syn = item.synopsis || 'Sinopsis belum tersedia dari situs sumber.';
  setContent(`<section class="detail">
    <div class="d-bg">${item.thumbnail ? `<img src="${esc(thumb(item.thumbnail))}" ${thumb(item.thumbnail) !== item.thumbnail ? `data-alt="${esc(item.thumbnail)}"` : ''} alt="" referrerpolicy="no-referrer" onerror="imgFail(this)">` : ''}</div>
    <div class="d-top"><a class="icon-btn" href="#latest" data-act="back" aria-label="Kembali">${ic('arrow-l')}</a><a class="icon-btn" href="${esc(item.url || 'https://komiku.online')}" target="_blank" rel="noopener noreferrer" aria-label="Buka situs sumber">${ic('external')}</a></div>
    <div class="d-main">
      <div class="d-poster">${coverImg(item.thumbnail, title, true)}</div>
      <div class="d-info">
        <div class="d-kind">${esc(item.type || 'Komik')}</div>
        <h1>${esc(title)}</h1>
        <div class="chips">${genreChipsHtml || '<span class="muted">Genre belum tersedia</span>'}</div>
        <div class="d-meta"><div><small>Tipe</small><strong>${esc(item.type || 'Komik')}</strong></div><div><small>Status</small><strong class="${item.status === 'Completed' ? '' : 'ok'}">${esc(item.status || 'Ongoing')}</strong></div><div><small>Total Chapter</small><strong>${chapters.length || item.total_chapters || 0}</strong></div></div>
        <div class="d-actions">${main}
          <button class="btn ${saved ? 'on' : ''}" data-act="bm" data-key="${esc(key)}" aria-pressed="${saved}">${ic('bookmark')}<span>${saved ? 'Tersimpan' : 'Bookmark'}</span></button>
          ${latest && (first || last) ? `<a class="btn" href="${hrefOf(latest)}">Chapter Terbaru</a>` : ''}</div>
      </div>
    </div>
    <div class="d-syn"><h3>Sinopsis</h3><p class="synopsis" id="syn">${esc(syn)}</p>${syn.length > 180 ? '<button class="link" data-act="syn" style="margin-top:6px">Selengkapnya</button>' : ''}</div>
    <div class="d-chap"><h3>Chapter Terbaru</h3>
      <div class="chap-tools"><label class="field">${ic('search')}<input id="chap-filter" type="search" placeholder="Filter chapter..." aria-label="Filter daftar chapter" autocomplete="off"></label><span class="chip mini">${chapters.length} chapter</span></div>
      <div class="chap-list" id="chap-list"></div><div class="more-wrap" id="chap-more"></div></div>
  </section>`);
  const lastKey = last ? keyOf(last.chapterSlug) : '';
  let shown = 40, filter = '';
  const listEl = $('#chap-list'), moreEl = $('#chap-more');
  const draw = () => {
    const pool = filter ? chapters.filter(c => (c.title || '').toLowerCase().includes(filter)) : chapters;
    if (!pool.length) { listEl.innerHTML = emptyMarkup('list', filter ? 'Chapter tidak ditemukan' : 'Daftar chapter belum terbaca', filter ? 'Coba kata kunci lain.' : 'Coba buka halaman sumber untuk melihat daftarnya.'); moreEl.innerHTML = ''; return; }
    listEl.innerHTML = pool.slice(0, shown).map((c, i) => {
      const ck = keyOf(c.slug || c.url);
      const read = readKeys.has(ck);
      return `<a class="chap ${read ? 'read' : ''} ${ck === lastKey ? 'last' : ''}" href="${hrefOf(c)}"><strong>${esc(c.title || `Chapter ${chapters.length - i}`)}</strong>${ck === lastKey ? '<span class="tag">Terakhir dibaca</span>' : ''}${read ? ic('check', 'ck') : ic('chev-r')}</a>`;
    }).join('');
    moreEl.innerHTML = pool.length > shown ? `<button class="btn" data-act="more">Tampilkan lebih banyak (${pool.length - shown})</button>` : '';
  };
  draw();
  moreEl.addEventListener('click', e => { if (e.target.closest('[data-act=more]')) { shown += 80; draw(); } });
  $('#chap-filter').addEventListener('input', e => { filter = e.target.value.toLowerCase().trim(); shown = 40; draw(); });
}

const reader = { detailSlug: '', mangaUrl: '' };
async function renderChapter(route) {
  const t = token;
  setContent(`<div class="reader-bar"><span class="icon-btn"></span><div class="reader-title"><strong>Membuka halaman baca...</strong></div></div><div class="stage">${Array.from({ length: 3 }, () => '<div class="sk" style="height:70vh;margin-bottom:6px;border-radius:0"></div>').join('')}</div>`);
  const chapter = await api(`/chapter?slug=${encodeURIComponent(route.slug)}`);
  if (t !== token) return;
  const images = chapter.images || [];
  reader.mangaUrl = chapter.manga_url || '';
  reader.detailSlug = reader.mangaUrl ? keyOf(reader.mangaUrl) : '';
  const prev = chapter.prev_chapter_url, next = chapter.next_chapter_url;
  const prevBtn = prev ? `<a class="btn" href="#chapter/${slugPath(prev)}">${ic('chev-l')} Sebelumnya</a>` : `<span class="btn off">${ic('chev-l')} Sebelumnya</span>`;
  const nextBtn = next ? `<a class="btn primary" href="#chapter/${slugPath(next)}">Berikutnya ${ic('chev-r')}</a>` : `<span class="btn primary off">Berikutnya ${ic('chev-r')}</span>`;
  setContent(`<div class="reader-bar">
      <button class="icon-btn" data-act="reader-back" aria-label="Kembali">${ic('arrow-l')}</button>
      <div class="reader-title"><strong id="r-comic">${esc(chapter.title || 'Baca komik')}</strong><small id="r-sub">${images.length} halaman</small></div>
      <span class="counter" id="r-count" aria-live="off">1 / ${images.length || 1}</span>
      ${prev ? `<a class="icon-btn" href="#chapter/${slugPath(prev)}" aria-label="Chapter sebelumnya">${ic('chev-l')}</a>` : ''}
      ${next ? `<a class="icon-btn" href="#chapter/${slugPath(next)}" aria-label="Chapter berikutnya">${ic('chev-r')}</a>` : ''}
      <a class="icon-btn" href="${API}/download?slug=${encodeURIComponent(chapter.url || chapter.slug)}" aria-label="Unduh ZIP">${ic('download')}</a>
      <button class="icon-btn" data-act="theme" aria-label="Ganti tema">${ic('sun')}</button>
    </div>
    <div class="progress" id="r-progress" style="display:block;position:fixed;top:0;bottom:auto;z-index:50"><i></i></div>
    <div class="stage" id="stage">${images.length ? images.map((src, i) => `<img src="${esc(src)}" data-alt="${esc(thumb(src))}" data-keep alt="Halaman ${i + 1}" data-i="${i}" loading="${i < 2 ? 'eager' : 'lazy'}" decoding="async" referrerpolicy="no-referrer" onload="this.classList.add('ld')" onerror="imgFail(this)">`).join('') : emptyMarkup('book', 'Gambar tidak ditemukan', 'Gambar chapter tidak ditemukan dari situs sumber.')}</div>
    <div class="end-card"><h3>— Akhir chapter —</h3><p>${next ? 'Lanjut ke chapter berikutnya?' : 'Belum ada chapter berikutnya.'}</p><div class="end-nav">${prevBtn}${nextBtn}<button class="btn wide" data-act="reader-back">${ic('list')} Daftar chapter</button></div></div>`);
  const count = $('#r-count'), bar = $('#r-progress i'), imgs = $$('#stage img');
  let io;
  if (imgs.length && 'IntersectionObserver' in window) {
    io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) count.textContent = `${+e.target.dataset.i + 1} / ${imgs.length}`; }), { rootMargin: '-45% 0px -50% 0px' });
    imgs.forEach(i => io.observe(i));
  }
  let raf = 0;
  const onScroll = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; const h = document.documentElement.scrollHeight - innerHeight; bar.style.transform = `scaleX(${h > 0 ? Math.min(1, scrollY / h) : 0})`; }); };
  addEventListener('scroll', onScroll, { passive: true });
  cleanup = () => { io?.disconnect(); removeEventListener('scroll', onScroll); };
  let detail = null;
  if (reader.detailSlug) { try { detail = await api(`/detail?slug=${encodeURIComponent(reader.detailSlug)}`); } catch {  } }
  if (detail) reader.detailSlug = detail.slug || reader.detailSlug;
  if (t === token && detail) {
    const c = $('#r-comic'), s = $('#r-sub');
    if (c && detail.title) { c.textContent = detail.title; if (s) s.textContent = `${chapter.title || ''} · ${images.length} halaman`; }
  }
  saveRecent(chapter, detail);
}

function historyRow(r, i = 0) {
  const href = `#chapter/${slugPath(r.chapterSlug)}`;
  const detailHref = r.slug ? `#detail/${slugPath(r.slug)}` : href;
  return `<article class="row" style="--i:${i}"><a class="row-cover" href="${detailHref}">${coverImg(r.thumbnail, r.title)}</a>
    <div class="row-body"><a class="row-title" href="${detailHref}">${esc(r.title)}</a><div class="row-sub">${esc(r.chapterTitle || 'Chapter terakhir')} · ${timeAgo(r.time)}</div></div>
    <div class="row-end"><button class="del" data-act="del-recent" data-key="${esc(comicKey(r))}" aria-label="Hapus dari riwayat">${ic('x')}</button><a class="btn primary sm" href="${href}">Lanjut</a></div></article>`;
}
function renderBookmarks() {
  const list = getBookmarks();
  const recent = getRecent();
  const filterEl = $('#bm-filter');
  const q = filterEl ? filterEl.value.toLowerCase().trim() : '';
  const shown = q ? list.filter(b => b.title.toLowerCase().includes(q)) : list;
  const rows = shown.map((b, i) => {
    const last = recent.find(r => keyOf(r.slug) === b.key);
    const href = `#detail/${slugPath(b.slug)}`;
    return `<article class="row" style="--i:${Math.min(i, 12)}"><a class="row-cover" href="${href}">${coverImg(b.thumbnail, b.title)}</a>
      <div class="row-body"><a class="row-title" href="${href}">${esc(b.title)}</a><div class="row-sub">${last ? esc(last.chapterTitle) : 'Belum mulai dibaca'}</div></div>
      <div class="row-end"><button class="del" data-act="bm" data-key="${esc(b.key)}" aria-label="Hapus bookmark">${ic('trash')}</button><a class="btn primary sm" href="${last ? `#chapter/${slugPath(last.chapterSlug)}` : href}">${last ? 'Lanjut' : 'Baca'}</a></div></article>`;
  }).join('');
  list.forEach(b => known.set(b.key, { key: b.key, slug: b.slug, title: b.title, thumbnail: b.thumbnail }));
  const body = !list.length ? emptyMarkup('bookmark', 'Belum ada bookmark', 'Tekan ikon bookmark pada komik untuk menyimpannya di sini.', `<a class="btn primary" href="#latest">Jelajahi komik</a>`)
    : `${list.length > 5 ? `<label class="field" style="margin-bottom:14px">${ic('search')}<input id="bm-filter" type="search" placeholder="Cari di bookmark..." value="${esc(q)}" autocomplete="off" aria-label="Cari di bookmark"></label>` : ''}<div class="list">${rows || emptyMarkup('search', 'Tidak ditemukan', 'Tidak ada bookmark dengan judul itu.')}</div>`;
  const hadFocus = document.activeElement?.id === 'bm-filter';
  if (filterEl && list.length > 5) { $('#bm-list-wrap').innerHTML = `<div class="list">${rows || emptyMarkup('search', 'Tidak ditemukan', 'Tidak ada bookmark dengan judul itu.')}</div>`; return; }
  setContent(`${pageHead('Bookmark', 'Komik yang kamu simpan', list.length ? `<span class="chip mini">${list.length} komik</span>` : '')}<div id="bm-list-wrap">${body}</div>`);
  if (hadFocus) $('#bm-filter')?.focus();
}
function renderRiwayat() {
  const list = recentComics();
  setContent(`${pageHead('Riwayat', 'Bacaan terakhir di perangkat ini', list.length ? `<button class="btn sm danger" data-act="clear-recent">${ic('trash')} Hapus semua</button>` : '')}
    ${list.length ? `<div class="list">${list.map(historyRow).join('')}</div>` : emptyMarkup('clock', 'Belum ada riwayat', 'Chapter yang kamu baca akan muncul di sini agar mudah dilanjutkan.', `<a class="btn primary" href="#latest">Mulai membaca</a>`)}`);
}

let pendingAvatar = '';
let avatarZoom = 1;
let avatarQuality = 82;
function openAvatarEditor() {
  pendingAvatar = settings.avatar || '';
  avatarZoom = 1; avatarQuality = 82;
  const m = $('#modal');
  m.innerHTML = `<div class="modal-card avatar-modal" role="dialog" aria-modal="true" aria-labelledby="avatar-title"><h3 id="avatar-title">Foto profil</h3><p>Pilih foto yang ingin kamu gunakan di Komik Mu.</p><div class="avatar-preview" id="avatar-preview">${pendingAvatar ? `<img src="${pendingAvatar}" alt="Preview foto profil">` : `<span>${esc((settings.name || 'P').trim().charAt(0).toUpperCase() || 'P')}</span>`}</div><input id="avatar-file" type="file" accept="image/*" hidden><button class="btn avatar-pick" data-avatar="pick">Pilih dari perangkat</button><div class="avatar-custom"><label>Zoom foto <strong id="avatar-zoom-value">100%</strong><input id="avatar-zoom" type="range" min="100" max="250" value="100" step="5"></label><label>Kualitas file <strong id="avatar-quality-value">82%</strong><input id="avatar-quality" type="range" min="40" max="95" value="82" step="5"></label><label>Ukuran tampilan foto <strong id="avatar-size-value">62 px</strong><input id="avatar-size" type="range" min="48" max="120" value="${Number(settings.avatarSize || 62)}" step="2"></label><p class="avatar-size-note">Zoom dan kualitas diterapkan saat gambar dipilih. Ukuran tampilan bisa diubah kapan saja.</p></div><div class="modal-actions"><button class="btn" data-avatar="cancel">Batal</button><button class="btn primary" data-avatar="save">Simpan</button></div>${settings.avatar ? `<button class="avatar-remove" data-avatar="remove">Hapus foto profil</button>` : ''}</div>`;
  m.hidden = false;
  m.oninput = e => {
    if (e.target.id === 'avatar-zoom') { avatarZoom = Number(e.target.value) / 100; const v = $('#avatar-zoom-value'); if (v) v.textContent = `${e.target.value}%`; if (pendingAvatar) refreshAvatarCrop(); }
    if (e.target.id === 'avatar-quality') { avatarQuality = Number(e.target.value); const v = $('#avatar-quality-value'); if (v) v.textContent = `${avatarQuality}%`; if (window.avatarOriginalImage) refreshAvatarCrop(); }
    if (e.target.id === 'avatar-size') { const v = $('#avatar-size-value'); if (v) v.textContent = `${e.target.value} px`; }
  };
  m.onclick = e => {
    if (e.target === m || e.target.closest('[data-avatar="cancel"]')) { m.hidden = true; m.innerHTML = ''; m.onclick = null; pendingAvatar = ''; return; }
    if (e.target.closest('[data-avatar="pick"]')) { $('#avatar-file')?.click(); return; }
    if (e.target.closest('[data-avatar="save"]')) {
      if (!pendingAvatar) { toast('Pilih foto terlebih dahulu'); return; }
      settings.avatar = pendingAvatar; settings.avatarSize = Number($('#avatar-size')?.value || settings.avatarSize || 62); saveSettings(); m.hidden = true; m.innerHTML = ''; m.onclick = null; pendingAvatar = ''; renderProfil(); toast('Foto profil disimpan'); return;
    }
    if (e.target.closest('[data-avatar="remove"]')) { settings.avatar = ''; saveSettings(); m.hidden = true; m.innerHTML = ''; m.onclick = null; pendingAvatar = ''; renderProfil(); toast('Foto profil dihapus'); }
  };
}
async function loadAvatarPreview(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) { toast('Pilih file gambar yang valid'); return; }
  if (file.size > 12 * 1024 * 1024) { toast('Ukuran foto maksimal 12 MB'); return; }
  try {
    const data = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(file); });
    const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = data; });
    window.avatarOriginalImage = img;
    refreshAvatarCrop();
  } catch { toast('Foto tidak dapat dibuka. Coba gambar lain.'); }
}
function refreshAvatarCrop() {
  const img = window.avatarOriginalImage;
  if (!img) return;
  const side = 512, canvas = document.createElement('canvas'); canvas.width = side; canvas.height = side;
  const ctx = canvas.getContext('2d');
  const base = Math.max(side / img.width, side / img.height) * avatarZoom;
  const w = img.width * base, h = img.height * base;
  ctx.drawImage(img, (side - w) / 2, (side - h) / 2, w, h);
  pendingAvatar = canvas.toDataURL('image/jpeg', avatarQuality / 100);
  const preview = $('#avatar-preview'); if (preview) preview.innerHTML = `<img src="${pendingAvatar}" alt="Preview foto profil">`;
}

function renderProfil() {
  const name = settings.name || 'Pengunjung';
  const sw = (on, act, label) => `<button class="switch" role="switch" aria-checked="${on}" data-act="${act}" aria-label="${label}"><i></i></button>`;
  const avatar = settings.avatar ? `<img src="${settings.avatar}" alt="Foto profil" class="avatar-photo">` : esc(name.trim().charAt(0).toUpperCase() || 'P');
  setContent(`${pageHead('Profil')}
    <div class="profile-card"><button class="avatar avatar-button ${settings.avatar ? 'has-photo' : ''}" style="--avatar-size:${Math.max(48, Math.min(120, Number(settings.avatarSize || 62)))}px" id="avatar" data-act="edit-avatar" aria-label="Ubah foto profil" title="Ubah foto profil">${avatar}<span class="avatar-edit">${ic('user')}</span></button><div class="profile-identity"><h2 id="pname">${esc(name)}</h2><span class="profile-storage-note muted">Data tersimpan di perangkat ini</span><button class="avatar-change" data-act="edit-avatar">${settings.avatar ? 'Ganti foto profil' : 'Tambah foto profil'}</button></div></div>
    <div class="stats"><a class="stat" href="#bookmark"><strong>${getBookmarks().length}</strong><span>Bookmark</span></a><a class="stat" href="#riwayat"><strong>${recentComics().length}</strong><span>Riwayat</span></a><div class="stat"><strong>${settings.read || 0}</strong><span>Total Baca</span></div></div>
    <div class="panel"><h3>Pengaturan</h3>
      <label class="setting">${ic('user')}<span class="grow">Nama panggilan</span><input class="text" data-setting="name" value="${esc(settings.name === 'Pengunjung' ? '' : settings.name)}" placeholder="Pengunjung" maxlength="24" aria-label="Nama panggilan"></label>
      <div class="setting">${ic('moon')}<span class="grow">Tampilan</span><div class="seg sm" role="group" aria-label="Tampilan">${[['dark', 'Gelap'], ['light', 'Terang'], ['auto', 'Auto']].map(([v, l]) => `<button class="${settings.theme === v ? 'on' : ''}" data-act="set-theme" data-v="${v}">${l}</button>`).join('')}</div></div>
      <div class="setting">${ic('bolt')}<span class="grow">Animasi<small>Matikan agar lebih hemat baterai</small></span>${sw(settings.motion !== false, 'toggle-motion', 'Animasi')}</div>
      <div class="setting">${ic('grid')}<span class="grow">Layar penuh<small>Sembunyikan bar browser</small></span>${sw(settings.fullscreen !== false, 'toggle-fs', 'Layar penuh')}</div>
    </div>
    <div class="panel"><h3>Data</h3>
      <button class="setting" data-act="clear-cache">${ic('layers')}<span class="grow">Bersihkan cache<small>Muat ulang data terbaru dari server</small></span></button>
      <button class="setting" data-act="clear-recent">${ic('clock')}<span class="grow">Hapus riwayat bacaan</span></button>
      <button class="setting" data-act="clear-bm">${ic('trash')}<span class="grow">Hapus semua bookmark</span></button>
    </div>
    <div class="panel"><h3>Lainnya</h3>
      <a class="setting" href="#bantuan">${ic('list')}<span class="grow">Cara menggunakan</span>${ic('chev-r')}</a>
      <a class="setting" href="#bantuan/faq">${ic('help')}<span class="grow">Bantuan &amp; FAQ</span>${ic('chev-r')}</a>
      <a class="setting" href="#tentang">${ic('info')}<span class="grow">Tentang kami</span>${ic('chev-r')}</a>
    </div>`);
}
function renderBantuan(route) {
  const steps = [['Cari Komik', 'Gunakan kolom pencarian atau jelajahi kategori dan genre yang tersedia.'], ['Pilih Chapter', 'Buka komik yang kamu inginkan, lalu pilih chapter dari daftar.'], ['Mulai Membaca', 'Nikmati komik favoritmu dengan tampilan vertikal yang nyaman.'], ['Bookmark (Opsional)', 'Simpan komik untuk dibaca nanti — progres terakhir juga tercatat otomatis.']];
  const faq = [
    ['Apakah Komik Mu gratis?', 'Ya, Komik Mu bisa digunakan gratis tanpa biaya apa pun.'],
    ['Apakah perlu daftar akun?', 'Tidak. Bookmark dan riwayat bacaan disimpan di browser perangkatmu, jadi tidak perlu akun.'],
    ['Bagaimana cara bookmark komik?', 'Tekan ikon bookmark di pojok sampul komik, atau tombol Bookmark di halaman detail. Lihat semuanya di menu Bookmark.'],
    ['Kenapa tidak bisa memuat chapter?', 'Data diambil dari situs sumber. Jika situs sumber sedang gangguan, berubah, atau membatasi akses, halaman bisa gagal dimuat. Coba lagi beberapa saat kemudian.'],
    ['Kenapa riwayat/bookmark hilang?', 'Data tersimpan di browser ini. Menghapus data situs atau memakai mode privat akan menghapusnya, begitu pula berganti perangkat.'],
    ['Apakah ada aplikasi mobile?', 'Belum ada aplikasi khusus. Buka Komik Mu lewat browser di ponselmu — tampilannya sudah menyesuaikan layar kecil.']
  ];
  setContent(`${pageHead('Cara Menggunakan', 'Ikuti langkah mudah berikut untuk mulai membaca komik di Komik Mu.')}
    <div class="steps">${steps.map(([a, b], i) => `<div class="step" style="--i:${i}"><b>${i + 1}</b><div><strong>${a}</strong><span>${b}</span></div></div>`).join('')}</div>
    <div id="faq">${pageHead('FAQ', 'Pertanyaan yang sering ditanyakan oleh pengguna Komik Mu.')}
    <div class="faq">${faq.map(([q, a], i) => `<details ${i === 0 ? 'open' : ''}><summary>${q}${ic('chev-d')}</summary><p>${a}</p></details>`).join('')}</div></div>`);
  if (route.faq) $('#faq')?.scrollIntoView();
}
function renderTentang() {
  setContent(`${pageHead('Tentang Kami')}<div class="about"><svg class="logo"><use href="#i-logo"/></svg><h2>Komik <b>Mu</b></h2>
    <p>Komik Mu adalah website baca komik online yang dibuat untuk para pecinta komik. Kami menyediakan antarmuka yang nyaman untuk membaca manga, manhwa, dan manhua dari satu tempat, dengan tampilan yang rapi dan ringan di berbagai perangkat.</p></div>
    <div class="feats"><div class="feat">${ic('bolt')}<strong>Update Terbaru</strong><span>Data langsung dari sumber</span></div><div class="feat">${ic('shield')}<strong>Tanpa Akun</strong><span>Data di perangkatmu</span></div><div class="feat">${ic('heart')}<strong>Gratis</strong><span>Tanpa biaya</span></div></div>
    <p class="note">Komik Mu adalah proyek pembaca pihak ketiga, bukan situs resmi Komiku. Metadata dan gambar diambil dari situs sumber; hak cipta karya tetap milik pemilik masing-masing. Hormati syarat penggunaan situs sumber dan dukung kreator dengan membeli karya resminya.</p>`);
}

const overlay = $('#search-overlay'), drawer = $('#drawer'), scrim = $('.scrim');
function closeOverlays() {
  modalDone?.(false);
  overlay.hidden = true; drawer.hidden = true; scrim.hidden = true;
  $('[data-act=menu]')?.setAttribute('aria-expanded', 'false');
}
function openDrawer() { closeOverlays(); drawer.hidden = false; scrim.hidden = false; $('[data-act=menu]')?.setAttribute('aria-expanded', 'true'); }
function openSearch() {
  closeOverlays();
  scrim.hidden = true;
  overlay.hidden = false;
  const recents = store.get(K.searches, []);
  $('#search-extra').innerHTML = `${recents.length ? `<div class="search-extra-sec"><h4>Pencarian terakhir <button data-act="clear-searches">Hapus</button></h4><div class="chips">${recents.map(s => `<a class="chip" href="#search/${slugPath(s)}">${esc(s)}</a>`).join('')}</div></div>` : ''}
    <div class="search-extra-sec"><h4>Kategori</h4><div class="mini-cats"><a href="#type/manga">${ic('layers')}Manga</a><a href="#type/manhwa">${ic('layers')}Manhwa</a><a href="#type/manhua">${ic('layers')}Manhua</a></div></div>
    <div class="search-extra-sec"><h4>Genre</h4><div class="chips" id="ov-genres">${genreChips(genres.slice(0, 16))}</div></div>`;
  genresReady.then(g => { const el = $('#ov-genres'); if (el && !el.children.length) el.innerHTML = genreChips(g.slice(0, 16)); });
  setTimeout(() => $('#search-input').focus(), 30);
}
function doSearch(q) {
  q = q.trim();
  if (!q) return toast('Masukkan judul komik yang ingin dicari.');
  store.set(K.searches, [q, ...store.get(K.searches, []).filter(s => s.toLowerCase() !== q.toLowerCase())].slice(0, 6));
  closeOverlays();
  $('#search-input').value = '';
  location.hash = `#search/${slugPath(q)}`;
}

document.addEventListener('click', async e => {
  const imgErr = e.target.closest?.('img.image-error');
  if (imgErr) { imgErr.classList.remove('image-error'); const s = imgErr.src; imgErr.src = ''; imgErr.src = s; return; }
  if (e.target.closest('.scrim')) return closeOverlays();
  if (e.target === overlay) return closeOverlays();
  if (e.target.closest('a[href^="#"]')) { if (!drawer.hidden || !overlay.hidden) closeOverlays(); const a = e.target.closest('a[href^="#"]'); if (a.getAttribute('href') === location.hash && !a.dataset.act) renderRoute(true); }
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  switch (act) {
    case 'menu': openDrawer(); break;
    case 'edit-avatar': openAvatarEditor(); break;
    case 'close': closeOverlays(); break;
    case 'search': openSearch(); break;
    case 'theme': settings.theme = resolvedTheme() === 'dark' ? 'light' : 'dark'; saveSettings(); applyTheme(); if (currentRoute?.name === 'profil') renderProfil(); break;
    case 'toggle-motion': settings.motion = settings.motion === false; saveSettings(); applyTheme(); el.setAttribute('aria-checked', String(settings.motion !== false)); break;
    case 'set-theme': settings.theme = el.dataset.v; saveSettings(); applyTheme(); renderProfil(); break;
    case 'toggle-fs': settings.fullscreen = settings.fullscreen === false; saveSettings(); el.setAttribute('aria-checked', String(settings.fullscreen !== false)); settings.fullscreen !== false ? goFullscreen() : document.fullscreenElement && document.exitFullscreen?.(); break;
    case 'bm': e.preventDefault(); toggleBookmark(el.dataset.key); break;
    case 'retry': renderRoute(true); break;
    case 'top': scrollTo({ top: 0, behavior: 'smooth' }); break;
    case 'syn': $('#syn').classList.toggle('open'); el.textContent = $('#syn').classList.contains('open') ? 'Lebih sedikit' : 'Selengkapnya'; break;
    case 'back': if (history.length > 1) { e.preventDefault(); history.back(); } break;
    case 'reader-back': location.hash = reader.detailSlug ? `#detail/${slugPath(reader.detailSlug)}` : reader.mangaUrl ? '#home' : '#home'; break;
    case 'clear-searches': store.set(K.searches, []); openSearch(); break;
    case 'clear-recent': if (await confirmDialog('Hapus riwayat?', 'Semua riwayat bacaan akan dihapus dari perangkat ini.')) { store.set(K.recent, []); toast('Riwayat dihapus'); renderRoute(true); } break;
    case 'del-recent': store.set(K.recent, getRecent().filter(r => comicKey(r) !== el.dataset.key)); renderRiwayat(); break;
    case 'clear-bm': if (await confirmDialog('Hapus bookmark?', 'Semua komik yang kamu simpan akan dihapus.')) { store.set(K.bm, []); toast('Bookmark dihapus'); renderProfil(); } break;
    case 'clear-cache': memCache.clear(); store.get('komikmu:cidx', []).forEach(k => { try { localStorage.removeItem(k); } catch {} }); store.set('komikmu:cidx', []); toast('Cache dibersihkan'); break;
    case 'random': {
      el.disabled = true;
      try {
        const item = await api('/random?detail=false', { fresh: true });
        const slug = item.slug || item.url;
        if (slug) location.hash = `#detail/${slugPath(slug)}`; else toast('Belum ada judul yang bisa dipilih.');
      } catch (err) { toast(err.message); }
      finally { el.disabled = false; }
      break;
    }
  }
});
document.addEventListener('submit', e => {
  const form = e.target.closest('form[data-search]');
  if (!form) return;
  e.preventDefault();
  doSearch($('input', form).value);
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.act === 'sort') location.hash = t.value;
  else if (t.dataset.setting === 'theme') { settings.theme = t.value; saveSettings(); applyTheme(); }
  else if (t.dataset.setting === 'name') { settings.name = t.value.trim() || 'Pengunjung'; saveSettings(); $('#pname').textContent = settings.name; const a = $('#avatar'); if (a && !settings.avatar) a.firstChild.textContent = settings.name.charAt(0).toUpperCase() || 'P'; toast('Nama disimpan'); }
  else if (t.id === 'avatar-file') loadAvatarPreview(t.files?.[0]);
});
document.addEventListener('input', e => { if (e.target.id === 'bm-filter') renderBookmarks(); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeOverlays();
  else if (e.key === '/' && !/input|textarea|select/i.test(e.target.tagName) && document.body.dataset.view !== 'chapter') { e.preventDefault(); openSearch(); }
});
const toTop = $('.to-top');
let topVisible = false, topRaf = 0;
addEventListener('scroll', () => {
  if (topRaf) return;
  topRaf = requestAnimationFrame(() => { topRaf = 0; const v = scrollY > 900; if (v !== topVisible) { topVisible = v; toTop.hidden = !v; } });
}, { passive: true });
matchMedia('(prefers-color-scheme: light)').addEventListener?.('change', () => { if (settings.theme === 'auto') applyTheme(); });
addEventListener('hashchange', () => renderRoute());

function goFullscreen() {
  const el = document.documentElement;
  if (document.fullscreenElement || !el.requestFullscreen) return;
  el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
}
function armFullscreen() {
  if (settings.fullscreen === false) return;
  addEventListener('pointerup', () => { if (settings.fullscreen !== false) goFullscreen(); }, { once: true });
}
const splash = $('#splash');
if (splash) {
  $('#splash-go').addEventListener('click', () => {
    try { sessionStorage.setItem('komikmu:splash', '1'); } catch {}
    if (settings.fullscreen !== false) goFullscreen();
    splash.classList.add('out');
    document.body.classList.remove('has-splash');
    setTimeout(() => splash.remove(), 450);
  });
} else armFullscreen();
['gesturestart', 'gesturechange'].forEach(ev => document.addEventListener(ev, e => e.preventDefault()));
if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));

if (!location.hash) location.hash = '#home';
else renderRoute(true);
