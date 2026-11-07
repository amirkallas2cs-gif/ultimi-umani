import { sql, json } from '../lib/db.js';

// Stato pubblico del gioco: HUD, ruoli con posti occupati, sopravvissuti verificati.
// Gli Infiltrati restano segreti: compaiono come umani senza ruolo.
export default async function handler(req, res) {
  try {
    const [state] = await sql`
      SELECT day, survivors, energy, goal, attack_target, attack_deadline, attack_status, ultima_line
      FROM game_state WHERE id = 1`;

    const roles = await sql`
      SELECT r.id, r.name, r.faction, r.description, r.max_slots, r.color, r.hidden, r.first_handle, r.sort,
        (SELECT count(*)::int FROM players p
          WHERE p.role_id = r.id
            AND (p.status = 'verified' OR (p.status = 'pending' AND p.created_at > now() - interval '48 hours'))) AS taken
      FROM roles r ORDER BY r.sort`;

    const players = await sql`
      SELECT p.handle, p.faction, p.role_id, p.is_first, r.name AS role_name, r.hidden, r.max_slots
      FROM players p JOIN roles r ON r.id = p.role_id
      WHERE p.status = 'verified'
      ORDER BY p.verified_at DESC
      LIMIT 150`;

    const factions = { h: 0, u: 0 };
    players.forEach(p => { factions[p.hidden ? 'h' : p.faction]++; });
    const [tot] = await sql`SELECT count(*)::int AS n FROM players WHERE status = 'verified'`;
    if (tot.n > players.length) factions.h += tot.n - players.length;

    const pubPlayers = players.map(p => p.hidden
      ? { handle: p.handle, faction: 'h', role: null, is_first: false, title: null }
      : {
          handle: p.handle,
          faction: p.faction,
          role: p.role_id,
          is_first: p.is_first,
          title: p.is_first ? (p.max_slots === 1 ? p.role_name : 'Primo ' + p.role_name) : p.role_name,
        });

    const pubRoles = roles.map(r => ({
      ...r,
      first_handle: r.hidden ? null : r.first_handle,
      first_secret: r.hidden && !!r.first_handle,
    }));

    json(res, 200, { state, roles: pubRoles, players: pubPlayers, factions },
      'public, s-maxage=10, stale-while-revalidate=30');
  } catch (e) {
    console.error(e);
    json(res, 500, { error: 'state_unavailable' });
  }
}
