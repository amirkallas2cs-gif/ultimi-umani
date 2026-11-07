import { randomInt } from 'node:crypto';
import { sql, json, readBody } from '../lib/db.js';

const ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const makeCode = () => 'GU-' + Array.from({ length: 5 }, () => ALPH[randomInt(ALPH.length)]).join('');

// Iscrizione: riserva un posto nel ruolo per 48 ore e restituisce il codice da commentare su Instagram.
export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Metodo non consentito.' });
  const b = await readBody(req);

  const handle = String(b.handle || '').trim().replace(/^@/, '');
  if (!/^[A-Za-z0-9._]{1,30}$/.test(handle)) return json(res, 400, { error: 'Username Instagram non valido.' });
  const faction = b.faction === 'u' ? 'u' : 'h';
  const role = String(b.role || '');
  if (!b.consent) return json(res, 400, { error: "Serve il consenso all'informativa privacy." });
  const email = b.email ? String(b.email).trim().slice(0, 120) : null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(res, 400, { error: 'Email non valida.' });
  const alert = !!(email && b.alert);

  try {
    await sql`UPDATE players SET status = 'expired'
              WHERE status = 'pending' AND created_at < now() - interval '48 hours'`;

    const existing = await sql`SELECT status FROM players
                               WHERE handle_lc = lower(${handle}) AND status <> 'expired' LIMIT 1`;
    if (existing.length) {
      return json(res, 409, {
        error: existing[0].status === 'verified'
          ? 'Questo sopravvissuto è già nel Rifugio.'
          : "Hai già un codice in attesa. Commentalo sotto l'ultimo Reel.",
      });
    }

    const code = makeCode();
    const rows = await sql`
      INSERT INTO players (handle, faction, role_id, email, alert_optin, consent_at, code)
      SELECT ${handle}, ${faction}, r.id, ${email}, ${alert}, now(), ${code}
      FROM roles r
      WHERE r.id = ${role} AND r.faction = ${faction}
        AND (SELECT count(*) FROM players p
             WHERE p.role_id = r.id
               AND (p.status = 'verified' OR (p.status = 'pending' AND p.created_at > now() - interval '48 hours'))
            ) < r.max_slots
      RETURNING code`;
    if (!rows.length) return json(res, 409, { error: 'Quel ruolo è appena stato riempito. Scegline un altro.' });

    await sql`INSERT INTO event_log (kind, payload)
              VALUES ('claim', ${JSON.stringify({ handle, role, faction, email: !!email })}::jsonb)`;
    json(res, 201, { code, handle, role, expires_hours: 48 });
  } catch (e) {
    if (String(e.message || '').includes('players_handle_active')) {
      return json(res, 409, { error: "Hai già un codice in attesa. Commentalo sotto l'ultimo Reel." });
    }
    console.error(e);
    json(res, 500, { error: 'Il Rifugio non risponde. Riprova tra poco.' });
  }
}
