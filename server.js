import app from './lib/app.js';

const port = Number(process.env.PORT) || 3000;
app.listen(port, '0.0.0.0', () => {
  console.log(`Komikmu berjalan di http://127.0.0.1:${port}`);
  console.log('API health:', `http://127.0.0.1:${port}/api/health`);
  console.log('Sumber scraper:', 'https://komiku.online');
});
