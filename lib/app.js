import express from 'express';
import archiver from 'archiver';
import dns from 'node:dns/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as scraper from './scraper.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const publicDir = path.resolve(__dirname, '../public');
const cache = new Map();
const requestCounts = new Map();

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '32kb' }));

app.use('/api', (req, res, next) => {
  if (req.path !== '/download') res.set('Cache-Control', 'no-store');
  if (req.path === '/health') return next();
  const now = Date.now();
  const ip = String(req.ip || req.socket.remoteAddress || 'unknown');
  const current = requestCounts.get(ip);
  if (!current || now - current.start > 60_000) {
    requestCounts.set(ip, { start: now, count: 1 });
    return next();
  }
  current.count += 1;
  if (current.count > 90) {
    res.set('Retry-After', '60');
    return res.status(429).json({ success: false, error: 'Terlalu banyak permintaan. Tunggu sebentar sebelum mencoba lagi.' });
  }
  next();
});

function withCache(key, ttlMs, fn) {
  const now = Date.now();
  const staleMs = Math.max(ttlMs * 5, 5 * 60_000);
  const item = cache.get(key);

  if (item?.promise) {
    if (item.value !== undefined && now < item.staleUntil) return Promise.resolve(item.value);
    return item.promise;
  }
  if (item?.value !== undefined && now < item.expires) return Promise.resolve(item.value);

  if (item?.value !== undefined && now < item.staleUntil) {
    const refresh = Promise.resolve().then(fn).then(value => {
      cache.set(key, { value, expires: Date.now() + ttlMs, staleUntil: Date.now() + ttlMs + staleMs });
      return value;
    }).catch(error => {
      const current = cache.get(key);
      if (current) cache.set(key, { value: current.value, expires: Date.now() + 5_000, staleUntil: current.staleUntil });
      console.warn(`[Komikmu cache] Refresh ${key} gagal: ${error.message}`);
      return undefined;
    });
    cache.set(key, { ...item, promise: refresh });
    return Promise.resolve(item.value);
  }

  const promise = Promise.resolve().then(fn).then(value => {
    cache.set(key, { value, expires: Date.now() + ttlMs, staleUntil: Date.now() + ttlMs + staleMs });
    return value;
  }).catch(error => {
    cache.delete(key);
    throw error;
  });
  cache.set(key, { ...(item?.value !== undefined ? { value: item.value, staleUntil: item.staleUntil } : {}), promise, expires: now + ttlMs });
  return promise;
}

function asyncRoute(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function pageFrom(req) {
  const n = Number.parseInt(req.query.page, 10);
  return Number.isFinite(n) ? Math.min(500, Math.max(1, n)) : 1;
}

function slugFrom(req) {
  const value = String(req.query.slug || req.query.url || '').trim();
  if (!value) {
    const error = new Error('Parameter slug atau url diperlukan.');
    error.status = 400;
    throw error;
  }
  if (value.length > 500) {
    const error = new Error('Parameter terlalu panjang.');
    error.status = 400;
    throw error;
  }
  return value;
}

app.get('/api/health', (_req, res) => {
  res.json({ success: true, name: 'Komikmu API', source: scraper.BASE_URL, time: new Date().toISOString() });
});

app.get('/api/home', asyncRoute(async (_req, res) => {
  const data = await withCache('home', 45_000, () => scraper.getHome());
  res.json({ success: true, ...data });
}));

app.get('/api/latest', asyncRoute(async (req, res) => {
  const page = pageFrom(req);
  const data = await withCache(`latest:${page}`, 45_000, () => scraper.getLatest(page));
  res.json({ success: true, ...data });
}));

app.get('/api/popular', asyncRoute(async (req, res) => {
  const page = pageFrom(req);
  const data = await withCache(`popular:${page}`, 90_000, () => scraper.getPopular({ page }));
  res.json({ success: true, ...data });
}));

app.get('/api/search', asyncRoute(async (req, res) => {
  const keyword = String(req.query.q || '').trim();
  if (!keyword) return res.status(400).json({ success: false, error: 'Isi kata kunci pencarian dahulu.' });
  const page = pageFrom(req);
  const key = `search:${keyword.toLowerCase()}:${page}`;
  const data = await withCache(key, 25_000, () => scraper.search(keyword, { page }));
  res.json({ success: true, ...data });
}));

app.get('/api/type/:type', asyncRoute(async (req, res) => {
  const type = String(req.params.type || '').toLowerCase();
  const page = pageFrom(req);
  const data = await withCache(`type:${type}:${page}`, 60_000, () => scraper.getByType(type, { page }));
  res.json({ success: true, ...data });
}));

app.get('/api/genres', (_req, res) => res.json({ success: true, genres: scraper.getGenres() }));

app.get('/api/genre/:genre', asyncRoute(async (req, res) => {
  const genre = String(req.params.genre || '').toLowerCase();
  const page = pageFrom(req);
  const data = await withCache(`genre:${genre}:${page}`, 60_000, () => scraper.getByGenre(genre, { page }));
  res.json({ success: true, ...data });
}));

app.get('/api/detail', asyncRoute(async (req, res) => {
  const slug = slugFrom(req);
  const data = await withCache(`detail:${slug}`, 60_000, () => scraper.getDetail(slug));
  res.json({ success: true, ...data });
}));

app.get('/api/chapter', asyncRoute(async (req, res) => {
  const slug = slugFrom(req);
  const data = await withCache(`chapter:${slug}`, 25_000, () => scraper.getChapter(slug));
  res.json({ success: true, ...data });
}));

app.get('/api/random', asyncRoute(async (req, res) => {
  const detail = String(req.query.detail || 'true') !== 'false';
  const data = await scraper.getRandom({ detail });
  res.json({ success: true, ...data });
}));

function isPrivateIp(address) {
  const version = net.isIP(address);
  if (version === 4) {
    const parts = address.split('.').map(Number);
    const [a, b] = parts;
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  if (version === 6) {
    const ip = address.toLowerCase();
    return ip === '::' || ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe8') || ip.startsWith('fe9') || ip.startsWith('fea') || ip.startsWith('feb') || ip.startsWith('::ffff:127.') || ip.startsWith('::ffff:10.');
  }
  return true;
}

async function assertPublicImageUrl(input) {
  let url;
  try { url = new URL(input); } catch { throw new Error('Alamat gambar tidak valid.'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Alamat gambar tidak diizinkan.');
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error('Alamat gambar internal tidak diizinkan.');
  }
  const records = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true }).catch(() => []);
  if (!records.length || records.some(record => isPrivateIp(record.address))) throw new Error('Host gambar tidak tersedia atau bukan host publik.');
  return url;
}

async function downloadImage(url) {
  let current = url;
  for (let redirects = 0; redirects <= 3; redirects++) {
    const parsed = await assertPublicImageUrl(current);
    const response = await fetch(parsed, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; KomikmuReader/1.0)', 'Referer': `${scraper.BASE_URL}/` },
      signal: AbortSignal.timeout(20_000),
      redirect: 'manual'
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new Error('Redirect gambar tidak sah.');
      current = new URL(location, parsed).href;
      continue;
    }
    if (!response.ok) throw new Error(`Gambar gagal dimuat (${response.status}).`);
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    if (contentType && !contentType.startsWith('image/')) throw new Error('Respons sumber bukan berkas gambar.');
    const declaredLength = Number(response.headers.get('content-length') || 0);
    if (declaredLength > 15 * 1024 * 1024) throw new Error('Ukuran gambar terlalu besar.');
    const data = Buffer.from(await response.arrayBuffer());
    if (data.length > 15 * 1024 * 1024) throw new Error('Ukuran gambar terlalu besar.');
    return data;
  }
  throw new Error('Terlalu banyak redirect gambar.');
}

function imageExtension(url) {
  try {
    const ext = path.extname(new URL(url).pathname).toLowerCase();
    return ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif'].includes(ext) ? ext.replace('.jpeg', '.jpg') : '.jpg';
  } catch { return '.jpg'; }
}

app.get('/api/download', asyncRoute(async (req, res) => {
  const slug = slugFrom(req);
  const chapter = await scraper.getChapter(slug);
  const urls = (chapter.images || []).slice(0, 120);
  if (!urls.length) return res.status(404).json({ success: false, error: 'Tidak ada gambar chapter yang ditemukan.' });
  if (chapter.images.length > 120) return res.status(413).json({ success: false, error: 'Chapter ini terlalu panjang untuk dijadikan ZIP (maksimal 120 halaman).' });

  const safeName = String(chapter.title || chapter.slug || 'chapter').replace(/[^a-z0-9\-_ ]/gi, '').trim().replace(/\s+/g, '-') || 'chapter';
  res.status(200);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName.slice(0, 90)}.zip"`);
  res.setHeader('Cache-Control', 'no-store');
  const archive = archiver('zip', { zlib: { level: 0 } });
  archive.on('warning', error => console.warn('[Komikmu ZIP]', error.message));
  archive.on('error', error => {
    console.error('[Komikmu ZIP]', error.message);
    if (!res.headersSent) res.status(500).json({ success: false, error: 'Gagal membuat ZIP chapter.' });
    else res.destroy(error);
  });
  archive.pipe(res);

  let totalBytes = 0;
  for (let i = 0; i < urls.length; i += 4) {
    const chunk = urls.slice(i, i + 4);
    const results = await Promise.all(chunk.map(async (url, offset) => {
      try { return { idx: i + offset, url, data: await downloadImage(url) }; }
      catch (error) { console.warn(`[Komikmu] Gambar ${i + offset + 1} dilewati: ${error.message}`); return null; }
    }));
    for (const item of results.filter(Boolean)) {
      totalBytes += item.data.length;
      if (totalBytes > 80 * 1024 * 1024) {
        archive.abort();
        return res.destroy(new Error('Ukuran ZIP melebihi had 80 MB.'));
      }
      const number = String(item.idx + 1).padStart(3, '0');
      archive.append(item.data, { name: `${number}${imageExtension(item.url)}` });
    }
  }
  await archive.finalize();
}));

const imgCache = new Map();
const imgInFlight = new Map();
let imgCacheBytes = 0;
const IMG_CACHE_MAX = 40 * 1024 * 1024;
const imgCounts = new Map();

async function fetchImageForProxy(input) {
  let current = input;
  for (let redirects = 0; redirects <= 3; redirects++) {
    const parsed = await assertPublicImageUrl(current);
    const response = await fetch(parsed, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', 'Referer': `${scraper.BASE_URL}/`, 'Accept': 'image/avif,image/webp,image*;q=0.8' },
      signal: AbortSignal.timeout(20_000),
      redirect: 'manual'
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new Error('Redirect gambar tidak sah.');
      current = new URL(location, parsed).href;
      continue;
    }
    if (!response.ok) throw new Error(`Gambar gagal dimuat (${response.status}).`);
    const type = (response.headers.get('content-type') || '').toLowerCase().split(';')[0].trim();
    if (!type.startsWith('image/') || type === 'image/svg+xml') throw new Error('Respons sumber bukan berkas gambar.');
    if (Number(response.headers.get('content-length') || 0) > 8 * 1024 * 1024) throw new Error('Ukuran gambar terlalu besar.');
    const data = Buffer.from(await response.arrayBuffer());
    if (data.length > 8 * 1024 * 1024) throw new Error('Ukuran gambar terlalu besar.');
    return { data, type };
  }
  throw new Error('Terlalu banyak redirect gambar.');
}

app.get('/img', asyncRoute(async (req, res) => {
  const raw = String(req.query.u || '');
  if (!raw || raw.length > 1500) return res.status(400).end();
  const ip = String(req.ip || req.socket.remoteAddress || 'unknown');
  const now = Date.now();
  const counter = imgCounts.get(ip);
  if (!counter || now - counter.start > 60_000) imgCounts.set(ip, { start: now, count: 1 });
  else if (++counter.count > 900) return res.status(429).end();
  let hit = imgCache.get(raw);
  if (hit) { imgCache.delete(raw); imgCache.set(raw, hit); }
  else {
    let pending = imgInFlight.get(raw);
    if (!pending) {
      pending = fetchImageForProxy(raw).then(result => {
        if (result.data.length <= 2 * 1024 * 1024) {
          imgCache.set(raw, result);
          imgCacheBytes += result.data.length;
          while (imgCacheBytes > IMG_CACHE_MAX && imgCache.size) {
            const oldest = imgCache.keys().next().value;
            imgCacheBytes -= imgCache.get(oldest).data.length;
            imgCache.delete(oldest);
          }
        }
        return result;
      }).finally(() => imgInFlight.delete(raw));
      imgInFlight.set(raw, pending);
    }
    hit = await pending;
  }
  res.set({ 'Content-Type': hit.type, 'Cache-Control': 'public, max-age=604800, immutable', 'X-Content-Type-Options': 'nosniff' });
  res.send(hit.data);
}));

app.use(express.static(publicDir, { extensions: ['html'], maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0 }));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.use((err, req, res, _next) => {
  const status = Number(err.status) || (err.message?.includes('tidak ditemukan') ? 404 : 502);
  console.error(`[Komikmu API] ${req.method} ${req.originalUrl}:`, err.message || err);
  if (res.headersSent) return res.end();
  res.status(status).json({ success: false, error: err.message || 'Permintaan gagal. Coba lagi.' });
});

export default app;
