import { neon } from '@neondatabase/serverless';

export const sql = neon(process.env.DATABASE_URL);

export function json(res, code, body, cache) {
  res.statusCode = code;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', cache || 'no-store');
  res.end(JSON.stringify(body));
}

export async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  let raw = '';
  for await (const chunk of req) raw += chunk;
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
}

// Posti occupati: verificati + in attesa da meno di 48 ore
export const PENDING_HOURS = 48;
