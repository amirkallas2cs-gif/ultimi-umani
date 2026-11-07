// Disegna il Reel del giorno un fotogramma alla volta (30 fps) dalla modalità render del sito.
// Ogni fotogramma viene completato prima della cattura: il video finale è fluido anche senza scheda grafica.
import fs from 'node:fs';
import { chromium } from 'playwright';
import { SITE, need, currentDay, episode, logNotion } from './lib.mjs';

need('SITE_URL');
const FPS = 30;
const day = await currentDay();
const ep = await episode(day);
if (!ep) {
  await logNotion('Errore', `Giorno ${day}: copione mancante`, 'Nessun episodio nel database: il video non è stato generato.');
  process.exit(1);
}

fs.rmSync('out', { recursive: true, force: true });
fs.mkdirSync('out/frames', { recursive: true });

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
// 720x1280 a densità 1,5 = fotogrammi 1080x1920
const page = await browser.newPage({ viewport: { width: 720, height: 1280 }, deviceScaleFactor: 1.5 });
page.on('pageerror', e => console.error('Errore nella pagina:', e.message));
await page.goto(`${SITE}/?render=1&day=${day}`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__reelReady === true, null, { timeout: 90000 });
const duration = await page.evaluate(() => window.__reelDuration);
const total = Math.round(duration * FPS);

const t0 = Date.now();
for (let i = 0; i < total; i++) {
  await page.evaluate(sec => window.__renderFrame(sec), i / FPS);
  await page.screenshot({ path: `out/frames/f${String(i).padStart(5, '0')}.jpg`, type: 'jpeg', quality: 92 });
  if (i % 150 === 0) console.log(`Fotogramma ${i}/${total} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
}
await browser.close();

fs.writeFileSync('out/meta.json', JSON.stringify({ day, fps: FPS, duration, frames: total, title: ep.title, caption: ep.caption || '', shot_seconds: ep.script?.shot_seconds || 4.2 }));
console.log(`Giorno ${day}: ${total} fotogrammi in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
