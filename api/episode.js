import { sql, json } from '../lib/db.js';

// Copione pubblico di un episodio, letto dalla modalità render del sito.
export default async function handler(req, res) {
  const day = parseInt(new URL(req.url, 'http://x').searchParams.get('day'), 10);
  if (!Number.isFinite(day) || day < 0) return json(res, 400, { error: 'Giorno non valido.' });
  try {
    const rows = await sql`SELECT day, title, script, caption, blocked FROM episodes WHERE day = ${day}`;
    if (!rows.length) return json(res, 404, { error: 'Episodio non trovato.' });
    json(res, 200, rows[0], 'public, s-maxage=30');
  } catch (e) {
    console.error(e);
    json(res, 500, { error: 'Errore del server.' });
  }
}
