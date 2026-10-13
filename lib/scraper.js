import * as cheerio from 'cheerio';

export const BASE_URL = 'https://komiku.online';

const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
  'Referer': `${BASE_URL}/`
};

export const GENRES = [
  'aksi', 'komedi', 'romantis', 'drama', 'shounen', 'petualangan',
  'school-life', 'slice-of-life', 'seinen', 'supernatural', 'bela-diri',
  'ecchi', 'harem', 'shoujo', 'misteri', 'sejarah', 'ngewe', 'sihir',
  'fiksi-ilmiah', 'psikologis', 'horor', 'reinkarnasi', 'dewasa', 'tragedi'
];

const ALLOWED_HOSTS = new Set(['komiku.online', 'www.komiku.online']);

function trustedPageUrl(input) {
  const raw = String(input || '').trim();
  let url;
  try {
    url = /^https?:\/\//i.test(raw) ? new URL(raw) : new URL(raw.startsWith('/') ? raw : `/${raw}`, BASE_URL);
  } catch {
    throw new Error('URL komik tidak valid.');
  }
  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error('URL hanya boleh berasal dari komiku.online.');
  }
  url.hash = '';
  return url;
}

function formatUrl(path) {
  if (!path) return '';
  try {
    const url = new URL(path, BASE_URL);
    return /^https?:$/.test(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

function extractSlug(urlOrSlug) {
  if (!urlOrSlug) return '';
  let path = String(urlOrSlug).trim();
  try {
    if (/^https?:\/\//i.test(path)) path = new URL(path).pathname;
  } catch { return ''; }
  path = path.replace(/^\/+|\/+$/g, '').replace(/^baca\//i, '');
  const bits = path.split('/').filter(Boolean);
  return bits.at(-1) || '';
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function parseCard($, el) {
  const card = $(el);
  const linkEl = card.is('a') ? card : card.find('a').first();
  const rawUrl = linkEl.attr('href') || card.attr('href') || '';
  const url = formatUrl(rawUrl);
  const slug = extractSlug(rawUrl);
  const img = card.find('img').first();
  const thumbnail = formatUrl(
    img.attr('data-src') || img.attr('data-lazy-src') || img.attr('data-original') || img.attr('src') || ''
  );
  const title = cleanText(card.find('.kmk-kartu-judul').first().text()) || cleanText(linkEl.attr('title')) || cleanText(img.attr('alt'));
  const meta = cleanText(card.find('.kmk-kartu-meta').first().text());
  const chText = cleanText(card.find('.kmk-kartu-ch').first().text());

  let genre = '';
  let totalChapters = '';
  if (meta.includes('·')) {
    const parts = meta.split('·');
    genre = cleanText(parts[0]);
    totalChapters = cleanText(parts.slice(1).join('·'));
  } else {
    genre = meta;
  }

  return { title, slug, url, thumbnail, genre, total_chapters: totalChapters || chText, meta };
}

async function fetchHtml(input) {
  const target = trustedPageUrl(input);
  let response;
  try {
    response = await fetch(target, {
      headers: DEFAULT_HEADERS,
      signal: AbortSignal.timeout(15000),
      redirect: 'follow'
    });
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw new Error('Situs sumber terlalu lama merespons. Coba lagi sebentar.');
    }
    throw new Error(`Gagal menghubungi situs sumber: ${error.message || 'koneksi gagal'}`);
  }

  let finalUrl;
  try { finalUrl = new URL(response.url); } catch { finalUrl = target; }
  if (!ALLOWED_HOSTS.has(finalUrl.hostname.toLowerCase())) {
    throw new Error('Situs sumber mengalihkan permintaan ke host yang tidak diizinkan.');
  }
  if (!response.ok) {
    const err = new Error(`Situs sumber merespons dengan status ${response.status}.`);
    err.status = response.status;
    throw err;
  }
  return await response.text();
}

function parseCards(html) {
  const $ = cheerio.load(html);
  const items = [];
  $('.kmk-kartu').each((_, el) => {
    const card = parseCard($, el);
    if (card.title && (card.slug || card.url)) items.push(card);
  });
  if (!items.length) {
    $('a[href]').each((_, el) => {
      const a = $(el);
      const href = a.attr('href') || '';
      const img = a.find('img').first();
      const title = cleanText(a.attr('title') || img.attr('alt') || a.text());
      if (!title || !img.length || !href || !/komiku\.online|^\//i.test(href)) return;
      const url = formatUrl(href);
      const slug = extractSlug(href);
      if (!slug || !url || /^(genre|baca|manga|manhwa|manhua|terbaru|populer|page)$/i.test(slug)) return;
      if (items.some(item => item.url === url)) return;
      items.push({
        title,
        slug,
        url,
        thumbnail: formatUrl(img.attr('data-src') || img.attr('data-lazy-src') || img.attr('src') || ''),
        genre: '',
        total_chapters: '',
        meta: ''
      });
    });
  }
  return items;
}

function pageNumber(value) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? Math.min(500, Math.max(1, n)) : 1;
}

export async function getHome() {
  const html = await fetchHtml(BASE_URL);
  const $ = cheerio.load(html);
  const items = [];
  $('.kmk-kartu').each((_, el) => {
    const card = parseCard($, el);
    if (card.title && (card.slug || card.url)) items.push(card);
  });
  if (!items.length) items.push(...parseCards(html));
  return { total: items.length, latest: items.slice(0, 20), popular: items.slice(20), items };
}

export async function getPopular(options = {}) {
  const page = pageNumber(options.page);
  const targetUrl = `${BASE_URL}/populer/${page > 1 ? `page/${page}/` : ''}`;
  const items = parseCards(await fetchHtml(targetUrl));
  return { page, total: items.length, items };
}

export async function getLatest(page = 1) {
  const pageNum = pageNumber(page);
  const targetUrl = `${BASE_URL}/terbaru/${pageNum > 1 ? `page/${pageNum}/` : ''}`;
  const items = parseCards(await fetchHtml(targetUrl));
  return { page: pageNum, total: items.length, items };
}

export async function search(keyword, options = {}) {
  if (!keyword || typeof keyword !== 'string' || !keyword.trim()) throw new Error('Masukkan judul komik untuk dicari.');
  const page = pageNumber(options.page);
  const params = new URLSearchParams({ s: keyword.trim().slice(0, 100) });
  if (page > 1) params.set('paged', String(page));
  const items = parseCards(await fetchHtml(`${BASE_URL}/?${params}`));
  return { keyword: keyword.trim(), page, total: items.length, results: items };
}

export async function getByType(type = 'manhwa', options = {}) {
  const validTypes = ['manga', 'manhwa', 'manhua'];
  const cleanType = String(type).trim().toLowerCase();
  if (!validTypes.includes(cleanType)) throw new Error('Tipe komik harus manga, manhwa, atau manhua.');
  const page = pageNumber(options.page);
  const targetUrl = `${BASE_URL}/${cleanType}/${page > 1 ? `page/${page}/` : ''}`;
  const items = parseCards(await fetchHtml(targetUrl));
  return { type: cleanType, page, total: items.length, items };
}

export async function getByGenre(genreSlug, options = {}) {
  const cleanSlug = String(genreSlug || '').trim().toLowerCase();
  if (!GENRES.includes(cleanSlug)) throw new Error('Genre tersebut tidak tersedia.');
  const page = pageNumber(options.page);
  const targetUrl = `${BASE_URL}/genre/${encodeURIComponent(cleanSlug)}/${page > 1 ? `page/${page}/` : ''}`;
  const items = parseCards(await fetchHtml(targetUrl));
  return { genre: cleanSlug, page, total: items.length, items };
}

export async function getDetail(slugOrUrl) {
  if (!slugOrUrl || typeof slugOrUrl !== 'string') throw new Error('Slug atau URL komik diperlukan.');
  const raw = slugOrUrl.trim();
  const targetUrl = /^https?:\/\//i.test(raw)
    ? trustedPageUrl(raw).href
    : trustedPageUrl(`/${extractSlug(raw)}/`).href;
  const html = await fetchHtml(targetUrl);
  const $ = cheerio.load(html);
  const rawTitle = cleanText($('h1').first().text());
  const title = rawTitle.replace(/^Komik\s+/i, '').trim() || cleanText($('title').first().text());
  const slug = extractSlug(targetUrl);
  const poster = $('img[src*="poster"], img[data-src*="poster"]').first();
  const firstImg = $('img').first();
  const thumbnail = formatUrl(poster.attr('data-src') || poster.attr('src') || firstImg.attr('data-src') || firstImg.attr('src') || '');
  const metaText = cleanText($('p').filter((_, el) => /adalah|bergenre/i.test($(el).text())).first().text());

  let type = 'Manga';
  if (/manhwa/i.test(metaText)) type = 'Manhwa';
  else if (/manhua/i.test(metaText)) type = 'Manhua';

  const status = /tamat|completed|complete/i.test(metaText) ? 'Completed' : 'Ongoing';
  const genres = [];
  $('a[href*="/genre/"]').each((_, a) => {
    const name = cleanText($(a).text());
    let genreSlug = '';
    try { genreSlug = new URL($(a).attr('href'), BASE_URL).pathname.match(/\/genre\/([^/]+)/)?.[1] || ''; } catch {}
    if (name && genreSlug && !genres.some(g => g.slug === genreSlug)) {
      genres.push({ name, slug: genreSlug, url: `${BASE_URL}/genre/${genreSlug}/` });
    }
  });
  const synopsis = cleanText($('p').filter((_, el) => /adalah/i.test($(el).text())).first().text()) || cleanText($('meta[name="description"]').attr('content')) || cleanText($('p').eq(1).text());
  const chapters = [];
  $('a[href*="/baca/"]').each((_, a) => {
    const hrefRaw = $(a).attr('href') || '';
    const href = formatUrl(hrefRaw);
    const path = (() => { try { return new URL(href).pathname; } catch { return ''; } })();
    if (!path || !path.startsWith('/baca/')) return;
    const chapterSlug = extractSlug(path);
    const chapterTitle = cleanText($(a).text());
    if (!chapterSlug || !chapterTitle || chapters.some(c => c.url === href)) return;
    chapters.push({ title: chapterTitle, slug: chapterSlug, url: href });
  });
  return {
    title, slug, url: targetUrl, thumbnail, type, status, genres, synopsis,
    first_chapter: chapters.length ? chapters.at(-1) : null,
    latest_chapter: chapters.length ? chapters[0] : null,
    total_chapters: chapters.length,
    chapters
  };
}

export async function getChapter(slugOrUrl) {
  if (!slugOrUrl || typeof slugOrUrl !== 'string') throw new Error('Slug atau URL chapter diperlukan.');
  const raw = slugOrUrl.trim();
  let targetUrl = /^https?:\/\//i.test(raw)
    ? trustedPageUrl(raw).href
    : trustedPageUrl(`/baca/${extractSlug(raw)}/`).href;
  let html;
  try {
    html = await fetchHtml(targetUrl);
  } catch (error) {
    if (error.status !== 404) throw error;
    const fallbackSlug = extractSlug(raw);
    const detail = await getDetail(fallbackSlug);
    if (!detail.first_chapter?.url) throw new Error(`Chapter tidak ditemukan untuk: ${raw}`);
    targetUrl = trustedPageUrl(detail.first_chapter.url).href;
    html = await fetchHtml(targetUrl);
  }

  const $ = cheerio.load(html);
  const title = cleanText($('h1').first().text()) || cleanText($('title').first().text());
  let prevChapterUrl = null;
  let nextChapterUrl = null;
  let mangaUrl = null;
  $('a').each((_, a) => {
    const text = cleanText($(a).text());
    const href = formatUrl($(a).attr('href') || '');
    if (!href) return;
    if (/sebelumnya|previous|‹/i.test(text)) prevChapterUrl = href;
    else if (/selanjutnya|berikutnya|next|›/i.test(text)) nextChapterUrl = href;
    else if (/semua chapter|daftar chapter/i.test(text)) mangaUrl = href.replace(/#chapter$/, '');
  });

  const imageSet = new Set();
  $('img').each((_, el) => {
    const img = $(el);
    const srcset = (img.attr('data-srcset') || img.attr('srcset') || '').split(',').map(part => part.trim().split(/\s+/)[0]);
    const candidates = [img.attr('data-src'), img.attr('data-lazy-src'), img.attr('data-original'), img.attr('src'), ...srcset];
    for (const candidate of candidates) {
      const src = formatUrl(candidate || '');
      if (!src) continue;
      const lower = src.toLowerCase();
      if (/logo|favicon|\/assets?\/|\/theme\/|banner|iklan|avatar|emoji|gravatar/.test(lower)) continue;
      if (!/\.(?:jpe?g|png|webp|gif|avif)(?:[?#]|$)/i.test(lower) && !/komik|chapter|image|upload|cdn/i.test(lower)) continue;
      imageSet.add(src);
      break;
    }
  });
  const images = [...imageSet];
  return {
    title, slug: extractSlug(targetUrl), url: targetUrl, manga_url: mangaUrl,
    prev_chapter_url: prevChapterUrl, next_chapter_url: nextChapterUrl,
    total_images: images.length, images
  };
}

export async function getRandom(options = {}) {
  const home = await getHome();
  const items = home.items || [];
  if (!items.length) throw new Error('Belum ada komik untuk dipilih secara acak.');
  const item = items[Math.floor(Math.random() * items.length)];
  if (options.detail !== false && item.slug) return getDetail(item.slug);
  return item;
}

export function getGenres() {
  return [...GENRES];
}
