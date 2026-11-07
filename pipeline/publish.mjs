// Pubblica il Reel del giorno su Instagram, salvo che su Notion sia spuntato "Blocca".
import { need, admin, currentDay, episode, notionEnabled, episodePage, updatePage, prop, logNotion } from './lib.mjs';

need('SITE_URL', 'ADMIN_TOKEN');
const day = await currentDay();
const ep = await episode(day);
const fail = async (msg) => {
  await logNotion('Errore', `Giorno ${day}: pubblicazione non riuscita`, msg);
  if (page) await updatePage(page.id, { Stato: prop.status('Errore') }).catch(() => {});
  process.exit(1);
};

let page = null;
if (notionEnabled()) page = await episodePage(day, ep?.title);

if (page?.properties?.Blocca?.checkbox) {
  await updatePage(page.id, { Stato: prop.status('Bloccato') });
  await admin('episode_media', { day, blocked: true });
  await logNotion('Pubblicazione', `Giorno ${day}: bloccato`, 'La casella Blocca era spuntata: niente pubblicazione oggi.');
  process.exit(0);
}

const videoUrl = page?.properties?.['Video Instagram']?.url;
if (!videoUrl) await fail('Il video Instagram non è pronto.');

if (!process.env.IG_USER_ID || !process.env.IG_ACCESS_TOKEN) {
  await logNotion('Pubblicazione', `Giorno ${day}: Instagram non ancora collegato`,
    'Mancano IG_USER_ID e IG_ACCESS_TOKEN. Il video è su Notion: si può pubblicare a mano.');
  process.exit(0);
}

const HOST = process.env.IG_GRAPH_HOST || 'graph.facebook.com';
const V = process.env.IG_GRAPH_VERSION || 'v21.0';
const base = `https://${HOST}/${V}`;
const tok = process.env.IG_ACCESS_TOKEN;
const call = async (path, params, method = 'POST') => {
  const url = new URL(`${base}/${path}`);
  const body = new URLSearchParams({ ...params, access_token: tok });
  const r = method === 'GET'
    ? await fetch(url + '?' + body)
    : await fetch(url, { method, body });
  const d = await r.json();
  if (!r.ok || d.error) throw new Error(d.error?.message || `HTTP ${r.status}`);
  return d;
};

try {
  const container = await call(`${process.env.IG_USER_ID}/media`, {
    media_type: 'REELS', video_url: videoUrl, caption: ep?.caption || '', share_to_feed: 'true',
  });
  // Instagram elabora il video: attendo fino a 10 minuti
  let status = 'IN_PROGRESS';
  for (let i = 0; i < 60 && status !== 'FINISHED'; i++) {
    await new Promise(r => setTimeout(r, 10000));
    status = (await call(container.id, { fields: 'status_code' }, 'GET')).status_code;
    if (status === 'ERROR' || status === 'EXPIRED') throw new Error('Instagram ha rifiutato il video: ' + status);
  }
  if (status !== 'FINISHED') throw new Error('Instagram non ha finito di elaborare il video in tempo.');
  const pub = await call(`${process.env.IG_USER_ID}/media_publish`, { creation_id: container.id });
  const info = await call(pub.id, { fields: 'permalink' }, 'GET');
  await admin('episode_media', { day, ig_media_id: pub.id, published: true });
  if (page) await updatePage(page.id, { Stato: prop.status('Pubblicato'), 'Reel Instagram': prop.url(info.permalink) });
  await logNotion('Pubblicazione', `Giorno ${day}: Reel pubblicato`, info.permalink || pub.id);
} catch (e) {
  await fail(e.message);
}
