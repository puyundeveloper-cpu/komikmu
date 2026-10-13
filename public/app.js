const API = '/api';
const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
const content = $('#page-content');
const genreList = $('#genre-list');
const browseToggle = $('#browse-toggle');
const browsePanel = $('#browse-panel');
const searchForm = $('#search-form');
const searchInput = $('#search-input');
const mobileSearchToggle = $('#mobile-search-toggle');
const toastEl = $('#toast');
let toastTimer;
let lastRouteKey = '';
let currentDetail = null;

const esc = (value = '') => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const slugPath = value => encodeURIComponent(String(value || '').trim());
const labelize = value => String(value || '').replace(/-/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());

function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2800);
}

async function api(path) {
  let response;
  try {
    response = await fetch(`${API}${path}`, { headers: { Accept: 'application/json' } });
  } catch {
    throw new Error('Tidak dapat terhubung ke server Komikmu. Periksa koneksi atau server.');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) throw new Error(data.error || `Permintaan gagal (${response.status}).`);
  return data;
}

function showLoading(message = 'Memuat komik...') {
  content.innerHTML = `<section class="loading-state"><span class="spinner"></span><p>${esc(message)}</p></section>`;
}

function showError(error, retryHash = location.hash || '#home') {
  content.innerHTML = `<section class="error-state"><span class="error-symbol">!</span><h2>Belum dapat memuat halaman</h2><p>${esc(error?.message || 'Terjadi masalah yang tidak diketahui.')}</p><button class="retry-button" id="retry-button">Coba lagi</button></section>`;
  $('#retry-button')?.addEventListener('click', () => {
    if (location.hash === retryHash) renderRoute(true);
    else location.hash = retryHash;
  });
}

function cardMarkup(item) {
  const title = item.title || 'Judul belum tersedia';
  const slug = item.slug || item.url || '';
  const image = item.thumbnail;
  const genre = item.genre && item.genre !== title ? item.genre : '';
  const chapter = item.total_chapters || '';
  const safeImage = image ? ` src="${esc(image)}"` : '';
  return `<article class="comic-card">
    <div class="cover-wrap">
      <button class="cover-button" data-detail="${esc(slug)}" aria-label="Buka ${esc(title)}">
        ${image ? `<img class="comic-cover"${safeImage} alt="Sampul ${esc(title)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.remove(); this.parentElement.querySelector('.cover-placeholder')?.classList.add('visible')">` : ''}
        <span class="cover-placeholder ${image ? '' : 'visible'}"><span class="placeholder-k">K.</span><span class="placeholder-title">${esc(title)}</span></span>
      </button>
      ${genre ? `<span class="cover-label">${esc(genre)}</span>` : ''}
      ${chapter ? `<span class="type-label">${esc(chapter)}</span>` : ''}
    </div>
    <button class="comic-title title-button" data-detail="${esc(slug)}">${esc(title)}</button>
    <div class="comic-meta"><span>${esc(genre || 'Komik')}</span>${chapter ? `<span class="meta-dot"></span><span>${esc(chapter)}</span>` : ''}</div>
  </article>`;
}

function sectionMarkup(title, subtitle, items, moreHash = '', countLabel = '') {
  return `<section class="section-block">
    <div class="section-head"><div class="section-title-wrap"><span class="section-marker"></span><div><h2>${esc(title)}</h2>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div></div>
      ${moreHash ? `<a class="text-link" href="${esc(moreHash)}">Lihat semua ↗</a>` : countLabel ? `<span class="result-count">${esc(countLabel)}</span>` : ''}
    </div>
    ${items?.length ? `<div class="comic-grid">${items.map(cardMarkup).join('')}</div>` : `<div class="empty-state"><p>Belum ada komik yang bisa ditampilkan di sini.</p></div>`}
  </section>`;
}

function pageIntro(title, subtitle, count) {
  return `<div class="page-intro"><div><h1>${esc(title)}</h1><p>${esc(subtitle || 'Jelajahi koleksi komik yang tersedia.')}</p></div>${typeof count === 'number' ? `<span class="result-count">${count} hasil di halaman ini</span>` : ''}</div>`;
}

function paginationMarkup(page, baseHash) {
  return `<nav class="pagination" aria-label="Paginasi">
    <button class="page-button" data-page="${page - 1}" data-base="${esc(baseHash)}" ${page <= 1 ? 'disabled' : ''}>← Sebelum</button>
    <button class="page-button current" aria-current="page">${page}</button>
    <button class="page-button" data-page="${page + 1}" data-base="${esc(baseHash)}">Berikut →</button>
  </nav>`;
}

function bindCards(scope = content) {
  $$('[data-detail]', scope).forEach(button => button.addEventListener('click', () => {
    const slug = button.dataset.detail;
    if (slug) location.hash = `#detail/${slugPath(slug)}`;
  }));
}

function bindPagination(scope = content) {
  $$('[data-page]', scope).forEach(button => button.addEventListener('click', () => {
    if (button.disabled) return;
    const base = button.dataset.base || '#latest';
    const joiner = base.includes('?') ? '&' : '?';
    location.hash = `${base}${joiner}page=${button.dataset.page}`;
  }));
}

function routeInfo() {
  const raw = (location.hash || '#home').replace(/^#/, '');
  const [rawPath, rawQuery = ''] = raw.split('?');
  const segments = rawPath.split('/').filter(Boolean).map(segment => {
    try { return decodeURIComponent(segment); } catch { return segment; }
  });
  const params = new URLSearchParams(rawQuery);
  const page = Math.max(1, Math.min(500, Number.parseInt(params.get('page') || '1', 10) || 1));
  if (!segments.length) return { name: 'home', page, key: `home:${page}` };
  if (segments[0] === 'search') return { name: 'search', q: segments.slice(1).join('/') || params.get('q') || '', page, key: `search:${segments.slice(1).join('/')} :${page}` };
  if (segments[0] === 'type') return { name: 'type', type: segments[1] || 'manhwa', page, key: `type:${segments[1]}:${page}` };
  if (segments[0] === 'genre') return { name: 'genre', genre: segments[1] || '', page, key: `genre:${segments[1]}:${page}` };
  if (segments[0] === 'detail') return { name: 'detail', slug: segments.slice(1).join('/'), key: `detail:${segments.slice(1).join('/')}` };
  if (segments[0] === 'chapter') return { name: 'chapter', slug: segments.slice(1).join('/'), key: `chapter:${segments.slice(1).join('/')}` };
  if (segments[0] === 'latest') return { name: 'latest', page, key: `latest:${page}` };
  if (segments[0] === 'popular') return { name: 'popular', page, key: `popular:${page}` };
  return { name: 'home', page, key: `home:${page}` };
}

function activeNav(route) {
  const key = route.name === 'type' ? `type/${route.type}` : route.name;
  $$('[data-nav]').forEach(link => link.classList.toggle('active', link.dataset.nav === key));
}

function closeBrowse() {
  browsePanel.hidden = true;
  browseToggle.setAttribute('aria-expanded', 'false');
  document.body.classList.remove('menu-open');
}

async function loadGenres() {
  try {
    const data = await api('/genres');
    const curated = data.genres || [];
    genreList.innerHTML = curated.map(genre => `<button class="genre-chip" data-genre="${esc(genre)}">${esc(labelize(genre))}</button>`).join('');
    $$('[data-genre]', genreList).forEach(button => button.addEventListener('click', () => {
      closeBrowse();
      location.hash = `#genre/${slugPath(button.dataset.genre)}`;
    }));
  } catch (error) {
    genreList.innerHTML = '<p class="muted">Genre belum dapat dimuat.</p>';
    console.warn(error);
  }
}

function hideHeroForReader(isReader) {
  $('#hero').hidden = isReader;
  $('.notice-bar').hidden = isReader;
}

async function renderHome() {
  showLoading('Memuat update terbaru...');
  const data = await api('/home');
  let popularItems = data.popular || [];
  if (!popularItems.length) {
    try { popularItems = (await api('/popular?page=1')).items || []; } catch { popularItems = []; }
  }
  let recentReads = [];
  try { recentReads = JSON.parse(localStorage.getItem('komikmu:recent') || '[]').slice(0, 3); } catch {}
  const continueHtml = recentReads.length ? `<section class="section-block"><div class="section-head"><div class="section-title-wrap"><span class="section-marker"></span><div><h2>Lanjutkan membaca</h2><p>Riwayat terakhir di perangkat ini</p></div></div></div><div class="continue-grid">${recentReads.map(item => `<a class="continue-card" href="#chapter/${slugPath(item.chapterSlug || item.slug)}"><img class="continue-cover" src="${esc(item.thumbnail || '')}" alt="" onerror="this.style.visibility='hidden'"><span class="continue-copy"><strong>${esc(item.title)}</strong><small>${esc(item.chapterTitle || 'Buka bacaan terakhir')} ↗</small><span class="continue-progress"><span></span></span></span></a>`).join('')}</div></section>` : '';
  const genres = ['aksi', 'romantis', 'komedi', 'petualangan', 'fantasi', 'horor', 'reinkarnasi', 'slice-of-life'];
  content.innerHTML = `${continueHtml}${sectionMarkup('Update terbaru', 'Chapter dan judul yang baru diperbarui', data.latest || data.items?.slice(0, 20) || [], '#latest')}${sectionMarkup('Pilihan populer', 'Komik yang sedang banyak dicari pembaca', popularItems.slice(0, 12), '#popular')}<section class="section-block"><div class="section-head"><div class="section-title-wrap"><span class="section-marker"></span><div><h2>Jelajahi genre</h2><p>Pilih suasana cerita yang kamu suka</p></div></div><button class="text-link" id="open-all-genres">Semua genre ↗</button></div><div class="genre-feature-grid">${genres.map(genre => `<button class="genre-feature" data-genre-feature="${genre}"><strong>${esc(labelize(genre))}</strong><span>Jelajahi ↗</span></button>`).join('')}</div></section>`;
  bindCards();
  $$('[data-genre-feature]').forEach(button => button.addEventListener('click', () => { location.hash = `#genre/${button.dataset.genreFeature}`; }));
  $('#open-all-genres')?.addEventListener('click', () => { browsePanel.hidden = false; browseToggle.setAttribute('aria-expanded', 'true'); browsePanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); });
}

async function renderCollection(route) {
  let data, title, subtitle, items, baseHash;
  const pageParam = `?page=${route.page}`;
  if (route.name === 'latest') {
    data = await api(`/latest${pageParam}`); title = 'Update terbaru'; subtitle = 'Chapter terkini dari berbagai judul'; items = data.items; baseHash = '#latest';
  } else if (route.name === 'popular') {
    data = await api(`/popular${pageParam}`); title = 'Komik populer'; subtitle = 'Jelajahi daftar komik populer'; items = data.items; baseHash = '#popular';
  } else if (route.name === 'type') {
    data = await api(`/type/${slugPath(route.type)}${pageParam}`); title = labelize(route.type); subtitle = `Koleksi ${route.type} yang tersedia`; items = data.items; baseHash = `#type/${route.type}`;
  } else if (route.name === 'genre') {
    data = await api(`/genre/${slugPath(route.genre)}${pageParam}`); title = `Genre ${labelize(route.genre)}`; subtitle = `Komik dengan genre ${labelize(route.genre)}`; items = data.items; baseHash = `#genre/${route.genre}`;
  } else {
    data = await api(`/search?q=${encodeURIComponent(route.q)}&page=${route.page}`); title = `Hasil: ${route.q}`; subtitle = 'Hasil pencarian dari situs sumber'; items = data.results; baseHash = `#search/${slugPath(route.q)}`;
  }
  content.innerHTML = `${pageIntro(title, subtitle, items?.length || 0)}${sectionMarkup(title, '', items || [], '', '')}${paginationMarkup(route.page, baseHash)}`;
  // Section title sudah berada dalam page-intro; buang heading section yang berulang.
  const extraHead = $('.section-head', content);
  if (extraHead && extraHead.parentElement) extraHead.remove();
  bindCards(); bindPagination();
}

function detailMarkup(item) {
  const title = item.title || 'Judul tidak diketahui';
  const thumbnail = item.thumbnail ? `<img class="detail-poster" src="${esc(item.thumbnail)}" alt="Sampul ${esc(title)}" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'">` : '<div class="detail-poster"></div>';
  const genres = (item.genres || []).map(genre => `<button class="genre-chip" data-genre-detail="${esc(genre.slug)}">${esc(genre.name)}</button>`).join('');
  const latest = item.latest_chapter;
  const first = item.first_chapter;
  const chapters = item.chapters || [];
  return `<section class="detail-hero">${thumbnail}<div class="detail-copy"><div class="detail-type-line">${esc(item.type || 'Komik')} · ${esc(item.status || 'Ongoing')}</div><h1>${esc(title)}</h1><div class="detail-badges"><span class="detail-badge status">${esc(item.status || 'Ongoing')}</span><span class="detail-badge">${chapters.length || item.total_chapters || 0} chapter ditemukan</span></div><p class="synopsis">${esc(item.synopsis || 'Sinopsis belum tersedia dari situs sumber.')}</p><div class="detail-genres">${genres || '<span class="muted">Genre belum tersedia</span>'}</div><div class="detail-actions">${latest ? `<a class="button button-primary" href="#chapter/${slugPath(latest.slug || latest.url)}">Baca chapter terbaru ↗</a>` : ''}${first ? `<a class="button button-quiet" href="#chapter/${slugPath(first.slug || first.url)}">Mulai dari awal</a>` : ''}<a class="button button-quiet" href="${esc(item.url || 'https://komiku.online')}" target="_blank" rel="noopener noreferrer">Sumber ↗</a></div></div></section>
  <section class="section-block"><div class="section-head"><div class="section-title-wrap"><span class="section-marker"></span><div><h2>Daftar chapter</h2><p>Pilih chapter untuk mulai membaca</p></div></div></div><div class="chapter-tools"><input class="chapter-filter" id="chapter-filter" type="search" placeholder="Filter chapter..." aria-label="Filter daftar chapter"><span class="result-count">${chapters.length} chapter</span></div><div class="chapter-list" id="chapter-list">${chapters.length ? chapters.map((chapter, i) => `<button class="chapter-row" data-chapter="${esc(chapter.slug || chapter.url)}" data-title="${esc(chapter.title)}"><span>${esc(chapter.title || `Chapter ${chapters.length - i}`)}</span><span>›</span></button>`).join('') : '<div class="empty-state"><p>Daftar chapter belum terbaca. Coba buka detail sumber.</p></div>'}</div></section>`;
}

async function renderDetail(route) {
  showLoading('Memuat detail komik dan daftar chapter...');
  const item = await api(`/detail?slug=${encodeURIComponent(route.slug)}`);
  currentDetail = item;
  content.innerHTML = detailMarkup(item);
  $$('[data-genre-detail]').forEach(button => button.addEventListener('click', () => { location.hash = `#genre/${slugPath(button.dataset.genreDetail)}`; }));
  $$('[data-chapter]').forEach(button => button.addEventListener('click', () => { location.hash = `#chapter/${slugPath(button.dataset.chapter)}`; }));
  const filter = $('#chapter-filter');
  filter?.addEventListener('input', () => {
    const q = filter.value.toLowerCase().trim();
    $$('.chapter-row', $('#chapter-list')).forEach(row => row.hidden = !row.dataset.title.toLowerCase().includes(q));
  });
}

function saveRecent(chapter, detail) {
  try {
    const current = JSON.parse(localStorage.getItem('komikmu:recent') || '[]');
    const record = {
      title: detail?.title || chapter.title || 'Komik',
      slug: detail?.slug || '',
      thumbnail: detail?.thumbnail || '',
      chapterSlug: chapter.slug,
      chapterTitle: chapter.title || 'Lanjutkan membaca',
      time: Date.now()
    };
    const next = [record, ...current.filter(item => item.chapterSlug !== record.chapterSlug)].slice(0, 8);
    localStorage.setItem('komikmu:recent', JSON.stringify(next));
  } catch { /* localStorage mungkin dimatikan browser */ }
}

async function renderChapter(route) {
  showLoading('Membuka halaman baca...');
  const chapter = await api(`/chapter?slug=${encodeURIComponent(route.slug)}`);
  const images = chapter.images || [];
  let detail = null;
  const fallbackMangaSlug = chapter.manga_url ? chapter.manga_url.replace(/\/$/, '').split('/').pop() : '';
  if (fallbackMangaSlug) {
    try { detail = await api(`/detail?slug=${encodeURIComponent(fallbackMangaSlug)}`); } catch {}
  }
  saveRecent(chapter, detail);
  const previous = chapter.prev_chapter_url ? `<a class="button button-quiet" href="#chapter/${slugPath(chapter.prev_chapter_url)}">← Chapter sebelumnya</a>` : `<button class="button button-quiet" disabled>← Chapter sebelumnya</button>`;
  const next = chapter.next_chapter_url ? `<a class="button button-primary" href="#chapter/${slugPath(chapter.next_chapter_url)}">Chapter berikutnya →</a>` : `<button class="button button-primary" disabled>Chapter berikutnya →</button>`;
  content.innerHTML = `<div class="reader-top"><button class="reader-back" id="reader-back">← Kembali</button><div class="reader-heading"><h1>${esc(chapter.title || 'Baca komik')}</h1><p>${images.length} halaman${detail?.title ? ` · ${esc(detail.title)}` : ''}</p></div><div class="reader-tools"><a class="reader-download" href="${API}/download?slug=${encodeURIComponent(chapter.url || chapter.slug)}">Unduh ZIP ↓</a></div></div>
    <div class="reader-stage" id="reader-stage">${images.length ? images.map((src, i) => `<img src="${esc(src)}" alt="Halaman ${i + 1}" loading="${i < 2 ? 'eager' : 'lazy'}" decoding="async" referrerpolicy="no-referrer" onerror="this.classList.add('image-error')">`).join('') : '<div class="reader-endcap">Gambar chapter tidak ditemukan dari situs sumber.</div>'}<div class="reader-endcap">— Akhir chapter —</div></div>
    <div class="reader-controls">${previous}<button class="button button-quiet" id="back-to-detail">Daftar chapter</button>${next}</div>`;
  $('#reader-back')?.addEventListener('click', () => {
    if (detail?.slug) location.hash = `#detail/${slugPath(detail.slug)}`;
    else location.hash = '#home';
  });
  $('#back-to-detail')?.addEventListener('click', () => {
    if (detail?.slug) location.hash = `#detail/${slugPath(detail.slug)}`;
    else if (chapter.manga_url) window.open(chapter.manga_url, '_blank', 'noopener,noreferrer');
    else location.hash = '#home';
  });
}

async function renderRoute(force = false) {
  const route = routeInfo();
  if (!force && route.key === lastRouteKey) return;
  lastRouteKey = route.key;
  closeBrowse();
  activeNav(route);
  hideHeroForReader(route.name === 'chapter');
  if (route.name !== 'chapter') window.scrollTo({ top: 0, behavior: 'smooth' });
  try {
    if (route.name === 'home') await renderHome();
    else if (['latest', 'popular', 'type', 'genre', 'search'].includes(route.name)) {
      if (route.name === 'search' && !route.q.trim()) { location.hash = '#home'; return; }
      showLoading(route.name === 'search' ? 'Mencari judul komik...' : 'Memuat daftar komik...');
      await renderCollection(route);
    } else if (route.name === 'detail') await renderDetail(route);
    else if (route.name === 'chapter') await renderChapter(route);
    else await renderHome();
  } catch (error) {
    showError(error, location.hash);
  }
}

searchForm.addEventListener('submit', event => {
  event.preventDefault();
  const q = searchInput.value.trim();
  if (!q) return toast('Masukkan judul komik yang ingin dicari.');
  closeBrowse();
  location.hash = `#search/${slugPath(q)}`;
});

browseToggle.addEventListener('click', () => {
  const open = browseToggle.getAttribute('aria-expanded') === 'true';
  browseToggle.setAttribute('aria-expanded', String(!open));
  browsePanel.hidden = open;
});

mobileSearchToggle.addEventListener('click', () => {
  let panel = $('#mobile-search-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'mobile-search-panel';
    panel.className = 'mobile-search-panel shell';
    const clone = searchForm.cloneNode(true);
    clone.id = 'mobile-search-form';
    clone.querySelector('input').id = 'mobile-search-input';
    panel.append(clone);
    $('.header-main').insertAdjacentElement('afterend', panel);
    clone.addEventListener('submit', event => {
      event.preventDefault();
      const q = $('#mobile-search-input').value.trim();
      if (!q) return toast('Masukkan judul komik yang ingin dicari.');
      searchInput.value = q;
      panel.remove();
      mobileSearchToggle.setAttribute('aria-expanded', 'false');
      location.hash = `#search/${slugPath(q)}`;
    });
  } else {
    panel.remove();
  }
  const opened = Boolean($('#mobile-search-panel'));
  mobileSearchToggle.setAttribute('aria-expanded', String(opened));
  if (opened) $('#mobile-search-input')?.focus();
});

$('#random-button').addEventListener('click', async () => {
  const button = $('#random-button');
  button.disabled = true;
  button.textContent = 'Sedang memilih...';
  try {
    const item = await api('/random?detail=false');
    const slug = item.slug || item.url;
    if (slug) location.hash = `#detail/${slugPath(slug)}`;
    else toast('Belum ada judul yang bisa dipilih.');
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; button.innerHTML = 'Pilih komik acak <span aria-hidden="true">⤨</span>'; }
});

window.addEventListener('hashchange', () => renderRoute());
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeBrowse();
});

loadGenres();
if (!location.hash) location.hash = '#home';
else renderRoute(true);
