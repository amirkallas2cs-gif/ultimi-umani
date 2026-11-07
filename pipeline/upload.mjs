// Carica i due video su Vercel Blob, li registra nel database e li mette su Notion.
import fs from 'node:fs';
import { put } from '@vercel/blob';
import { need, admin, notionEnabled, episodePage, updatePage, prop, logNotion } from './lib.mjs';

need('SITE_URL', 'ADMIN_TOKEN', 'BLOB_READ_WRITE_TOKEN');
const meta = JSON.parse(fs.readFileSync('out/meta.json', 'utf8'));
const up = name => put(`episodi/giorno-${meta.day}-${name}.mp4`, fs.readFileSync(`out/${name}.mp4`), {
  access: 'public', contentType: 'video/mp4', token: process.env.BLOB_READ_WRITE_TOKEN,
});

try {
  const ig = await up('instagram');
  const tt = await up('tiktok');
  let pageId = null;
  if (notionEnabled()) {
    const page = await episodePage(meta.day, meta.title);
    pageId = page.id;
    await updatePage(page.id, {
      'Video Instagram': prop.url(ig.url),
      'Video TikTok (senza musica)': prop.url(tt.url),
      Didascalia: prop.text(meta.caption),
      Stato: prop.status('Video pronto'),
    });
  }
  await admin('episode_media', { day: meta.day, video_url: ig.url, video_nomusic_url: tt.url, notion_page_id: pageId });
  await logNotion('Video', `Giorno ${meta.day}: video pronti`, `Instagram: ${ig.url}\nTikTok: ${tt.url}`);
} catch (e) {
  await logNotion('Errore', `Giorno ${meta.day}: caricamento video fallito`, e.message);
  process.exit(1);
}
