import { timingSafeEqual } from 'node:crypto';
import { sql, json, readBody } from '../lib/db.js';

// Pannello di controllo: verifica codici, aggiorna stato del gioco e posti dei ruoli.
// Protetto da ADMIN_TOKEN (header Authorization: Bearer <token>). Lo usano admin.html e le automazioni.

function authed(req) {
  const t = process.env.ADMIN_TOKEN || '';
  const h = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!t || h.length !== t.length) return false;
  return timingSafeEqual(Buffer.from(h), Buffer.from(t));
}
const int = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) && n >= 0 ? n : d; };
const STATUSES = ['in_corso', 'respinto', 'perso', 'nessuno'];
const log = (kind, payload) => sql`INSERT INTO event_log (kind, payload) VALUES (${kind}, ${JSON.stringify(payload)}::jsonb)`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Usa POST.' });
  if (!authed(req)) return json(res, 401, { error: 'Token non valido.' });
  const b = await readBody(req);

  try {
    switch (b.action) {
      case 'overview': {
        const [state] = await sql`SELECT * FROM game_state WHERE id = 1`;
        const pending = await sql`
          SELECT p.handle, p.code, p.faction, r.name AS role, p.created_at
          FROM players p JOIN roles r ON r.id = p.role_id
          WHERE p.status = 'pending' AND p.created_at > now() - interval '48 hours'
          ORDER BY p.created_at`;
        const roles = await sql`
          SELECT r.id, r.name, r.faction, r.max_slots, r.first_handle,
            (SELECT count(*)::int FROM players p WHERE p.role_id = r.id AND p.status = 'verified') AS verified,
            (SELECT count(*)::int FROM players p WHERE p.role_id = r.id AND p.status = 'pending'
               AND p.created_at > now() - interval '48 hours') AS pending
          FROM roles r ORDER BY r.sort`;
        const [counts] = await sql`
          SELECT count(*) FILTER (WHERE status = 'verified')::int AS verified,
                 count(*) FILTER (WHERE status = 'verified' AND alert_optin)::int AS email_optin
          FROM players`;
        return json(res, 200, { state, pending, roles, counts });
      }

      case 'verify': {
        const code = String(b.code || '').trim().toUpperCase();
        const v = await sql`UPDATE players SET status = 'verified', verified_at = now()
                            WHERE code = ${code} AND status = 'pending'
                            RETURNING id, handle, role_id`;
        if (!v.length) return json(res, 404, { error: 'Codice non trovato, scaduto o già verificato.' });
        const f = await sql`UPDATE roles SET first_handle = ${v[0].handle}
                            WHERE id = ${v[0].role_id} AND first_handle IS NULL RETURNING id`;
        if (f.length) await sql`UPDATE players SET is_first = true WHERE id = ${v[0].id}`;
        await log('verify', { code, handle: v[0].handle, role: v[0].role_id, first: !!f.length });
        return json(res, 200, { ok: true, handle: v[0].handle, role: v[0].role_id, first: !!f.length });
      }

      case 'reject': {
        const code = String(b.code || '').trim().toUpperCase();
        const v = await sql`UPDATE players SET status = 'expired'
                            WHERE code = ${code} AND status = 'pending' RETURNING handle`;
        if (!v.length) return json(res, 404, { error: 'Codice non trovato.' });
        await log('reject', { code, handle: v[0].handle });
        return json(res, 200, { ok: true });
      }

      case 'state': {
        const s = b.state || {};
        const [cur] = await sql`SELECT * FROM game_state WHERE id = 1`;
        const n = {
          day: int(s.day, cur.day),
          survivors: int(s.survivors, cur.survivors),
          energy: int(s.energy, cur.energy),
          goal: Math.max(1, int(s.goal, cur.goal)),
          target: s.attack_target ? String(s.attack_target).slice(0, 60) : cur.attack_target,
          deadline: s.attack_deadline === undefined ? cur.attack_deadline : (s.attack_deadline || null),
          status: STATUSES.includes(s.attack_status) ? s.attack_status : cur.attack_status,
          line: s.ultima_line === undefined ? cur.ultima_line : (String(s.ultima_line || '').slice(0, 280) || null),
        };
        await sql`UPDATE game_state SET day = ${n.day}, survivors = ${n.survivors}, energy = ${n.energy},
                    goal = ${n.goal}, attack_target = ${n.target}, attack_deadline = ${n.deadline},
                    attack_status = ${n.status}, ultima_line = ${n.line}, updated_at = now()
                  WHERE id = 1`;
        await log('state', n);
        return json(res, 200, { ok: true, state: n });
      }

      case 'slots': {
        const id = String(b.role || '');
        const max = int(b.max_slots, null);
        if (max === null) return json(res, 400, { error: 'Numero di posti non valido.' });
        const r = await sql`UPDATE roles SET max_slots = ${max} WHERE id = ${id} RETURNING id, max_slots`;
        if (!r.length) return json(res, 404, { error: 'Ruolo non trovato.' });
        await log('slots', { role: id, max_slots: max });
        return json(res, 200, { ok: true, role: r[0] });
      }

      case 'episode': {
        // Crea o aggiorna l'episodio del giorno (lo usa la sessione delle 15:00)
        const e = b.episode || {};
        const day = int(e.day, null);
        if (day === null) return json(res, 400, { error: 'Giorno mancante.' });
        const script = e.script && Array.isArray(e.script.shots) ? e.script : null;
        if (!script) return json(res, 400, { error: 'Copione mancante: servono script.shots.' });
        await sql`INSERT INTO episodes (day, title, script, caption, decision)
                  VALUES (${day}, ${e.title || null}, ${JSON.stringify(script)}::jsonb, ${e.caption || null}, ${e.decision || null})
                  ON CONFLICT (day) DO UPDATE SET title = EXCLUDED.title, script = EXCLUDED.script,
                    caption = EXCLUDED.caption, decision = EXCLUDED.decision`;
        await log('episode', { day, title: e.title || null });
        return json(res, 200, { ok: true, day });
      }

      case 'episode_media': {
        // La pipeline registra URL dei video, id del Reel e stato
        const day = int(b.day, null);
        if (day === null) return json(res, 400, { error: 'Giorno mancante.' });
        await sql`UPDATE episodes SET
                    video_url = COALESCE(${b.video_url || null}, video_url),
                    video_nomusic_url = COALESCE(${b.video_nomusic_url || null}, video_nomusic_url),
                    ig_media_id = COALESCE(${b.ig_media_id || null}, ig_media_id),
                    notion_page_id = COALESCE(${b.notion_page_id || null}, notion_page_id),
                    blocked = COALESCE(${typeof b.blocked === 'boolean' ? b.blocked : null}, blocked),
                    published_at = CASE WHEN ${!!b.published} THEN now() ELSE published_at END
                  WHERE day = ${day}`;
        await log('episode_media', { day, published: !!b.published });
        return json(res, 200, { ok: true });
      }

      default:
        return json(res, 400, { error: 'Azione sconosciuta.' });
    }
  } catch (e) {
    console.error(e);
    return json(res, 500, { error: 'Errore del server.' });
  }
}
