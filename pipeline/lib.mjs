// Funzioni condivise dalla pipeline: sito, Notion, log.
export const SITE = (process.env.SITE_URL || '').replace(/\/$/, '');
const NOTION = 'https://api.notion.com/v1';
const NOTION_HEADERS = () => ({
  authorization: `Bearer ${process.env.NOTION_TOKEN}`,
  'notion-version': '2022-06-28',
  'content-type': 'application/json',
});

export function need(...names) {
  const missing = names.filter(n => !process.env[n]);
  if (missing.length) throw new Error('Mancano queste variabili: ' + missing.join(', '));
}

export async function admin(action, extra = {}) {
  const r = await fetch(`${SITE}/api/admin`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.ADMIN_TOKEN}` },
    body: JSON.stringify({ action, ...extra }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`admin ${action}: ${d.error || r.status}`);
  return d;
}

export async function currentDay() {
  if (process.env.DAY !== undefined && process.env.DAY !== '') return parseInt(process.env.DAY, 10);
  const r = await fetch(`${SITE}/api/state`, { cache: 'no-store' });
  const d = await r.json();
  return d.state.day;
}

export async function episode(day) {
  const r = await fetch(`${SITE}/api/episode?day=${day}`, { cache: 'no-store' });
  if (!r.ok) return null;
  return r.json();
}

async function notion(path, body, method = 'POST') {
  const r = await fetch(NOTION + path, { method, headers: NOTION_HEADERS(), body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Notion ${path}: ${d.message || r.status}`);
  return d;
}

export const notionEnabled = () => !!(process.env.NOTION_TOKEN && process.env.NOTION_EPISODES_DB);

// Pagina Notion dell'episodio (la crea se manca)
export async function episodePage(day, title) {
  const q = await notion(`/databases/${process.env.NOTION_EPISODES_DB}/query`, {
    filter: { property: 'Giorno', number: { equals: day } }, page_size: 1,
  });
  if (q.results.length) return q.results[0];
  return notion('/pages', {
    parent: { database_id: process.env.NOTION_EPISODES_DB },
    properties: {
      Titolo: { title: [{ text: { content: title || `Giorno ${day}` } }] },
      Giorno: { number: day },
      Data: { date: { start: new Date().toISOString().slice(0, 10) } },
    },
  });
}

export async function updatePage(pageId, properties) {
  return notion(`/pages/${pageId}`, { properties }, 'PATCH');
}

export const prop = {
  url: v => ({ url: v || null }),
  status: v => ({ status: { name: v } }),
  text: v => ({ rich_text: [{ text: { content: String(v || '').slice(0, 1900) } }] }),
};

export async function logNotion(tipo, evento, dettagli = '') {
  console.log(`[${tipo}] ${evento} ${dettagli}`);
  if (!process.env.NOTION_TOKEN || !process.env.NOTION_LOG_DB) return;
  try {
    await notion('/pages', {
      parent: { database_id: process.env.NOTION_LOG_DB },
      properties: {
        Evento: { title: [{ text: { content: evento.slice(0, 200) } }] },
        Tipo: { select: { name: tipo } },
        Dettagli: { rich_text: [{ text: { content: String(dettagli).slice(0, 1900) } }] },
      },
    });
  } catch (e) { console.error('Log Notion non scritto:', e.message); }
}
