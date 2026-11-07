// Registra il Reel del giorno dalla modalità render del sito (Chromium senza schermo).
import fs from 'node:fs';
import { chromium } from 'playwright';
import { SITE, need, currentDay, episode, logNotion } from './lib.mjs';

need('SITE_URL');
const day = await currentDay();
const ep = await episode(day);
if (!ep) {
  await logNotion('Errore', `Giorno ${day}: copione mancante`, 'Nessun episodio nel database: il video non è stato generato.');
  process.exit(1);
}

fs.mkdirSync('out', { recursive: true });
const W = 720, H = 1280; // poi ffmpeg porta a 1080x1920
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const context = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: 'out', size: { width: W, height: H } } });
const page = await context.newPage();
const tOpen = Date.now();
await page.goto(`${SITE}/?render=1&day=${day}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__reelDuration > 0, null, { timeout: 60000 });
const lead = (Date.now() - tOpen) / 1000;
const duration = await page.evaluate(() => window.__reelDuration);
await page.waitForFunction(() => window.__reelDone === true, null, { timeout: (duration + 30) * 1000, polling: 250 });
await page.waitForTimeout(400);
const video = page.video();
await page.close();
await context.close();
fs.renameSync(await video.path(), 'out/raw.webm');
await browser.close();

fs.writeFileSync('out/meta.json', JSON.stringify({ day, lead, duration, title: ep.title, caption: ep.caption || '' }));
console.log(`Registrato giorno ${day}: ${duration}s (attacco a ${lead.toFixed(1)}s)`);
