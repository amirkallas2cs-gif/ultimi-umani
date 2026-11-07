// Voce narrante di ULTIMA: legge il testo di ogni inquadratura e allunga le inquadrature
// quanto serve perché la frase finisca. Produce out/voice.wav (già effettata) e out/voice.json.
//
// Motore: ElevenLabs se ci sono ELEVENLABS_API_KEY e ELEVENLABS_VOICE_ID (licenza commerciale),
// altrimenti Piper con la voce italiana "paola" (gratuita, licenza da verificare per uso commerciale).
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { need, currentDay, episode, logNotion } from './lib.mjs';

need('SITE_URL');
const LEAD = 0.35;   // secondi di silenzio prima della frase
const TAIL = 0.6;    // secondi dopo la frase prima del cambio inquadratura
const day = await currentDay();
const ep = await episode(day);
const shots = ep?.script?.shots || [];
const base = Number(ep?.script?.shot_seconds) || 4.2;

fs.mkdirSync('out/voice', { recursive: true });
const ff = args => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });
const probe = f => parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString());

// Testo da leggere: campo "say" se c'è, altrimenti il sottotitolo senza formattazione
const spoken = sh => String(sh.say || sh.cap || '')
  .replace(/\*\*|!!/g, '').replace(/\s*\n\s*/g, ' ').replace(/[«»"]/g, '').trim();

async function elevenlabs(text, file) {
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${process.env.ELEVENLABS_VOICE_ID}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.6, similarity_boost: 0.75 } }),
  });
  if (!r.ok) throw new Error(`ElevenLabs ${r.status}: ${(await r.text()).slice(0, 200)}`);
  fs.writeFileSync(file + '.mp3', Buffer.from(await r.arrayBuffer()));
  ff(['-i', file + '.mp3', '-ac', '1', '-ar', '44100', file]);
}

function piper(text, file) {
  const model = process.env.PIPER_MODEL || 'pipeline/voices/it_IT-paola-medium.onnx';
  execFileSync('piper', ['--model', model, '--output_file', file + '.raw.wav', '--length_scale', '1.08', '--sentence_silence', '0.25'],
    { input: text, stdio: ['pipe', 'inherit', 'inherit'] });
  ff(['-i', file + '.raw.wav', '-ac', '1', '-ar', '44100', file]);
}

const useEleven = !!(process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_VOICE_ID);
const durations = [], clips = [];
let start = 0;
try {
  for (let i = 0; i < shots.length; i++) {
    const text = spoken(shots[i]);
    let d = base;
    if (text) {
      const file = `out/voice/v${String(i).padStart(2, '0')}.wav`;
      if (useEleven) await elevenlabs(text, file); else piper(text, file);
      const len = probe(file);
      d = Math.max(base, LEAD + len + TAIL);
      clips.push({ file, at: start + LEAD });
    }
    durations.push(Number(d.toFixed(2)));
    start += d;
  }
} catch (e) {
  await logNotion('Errore', `Giorno ${day}: voce narrante non generata`, e.message);
  console.error('Voce non generata, il video esce senza:', e.message);
  process.exit(0);
}

const total = durations.reduce((a, b) => a + b, 0);
if (clips.length) {
  // Allinea le frasi sulla timeline e dà alla voce il timbro di ULTIMA:
  // un po' più grave, eco corta metallica e un leggero flanger
  const inputs = clips.flatMap(c => ['-i', c.file]);
  const delays = clips.map((c, k) => `[${k}]adelay=${Math.round(c.at * 1000)}:all=1[d${k}]`).join(';');
  const mix = clips.map((_, k) => `[d${k}]`).join('') +
    `amix=inputs=${clips.length}:normalize=0,apad,atrim=0:${total.toFixed(2)},` +
    `asetrate=44100*0.95,aresample=44100,atempo=1.0526,highpass=f=90,` +
    `aecho=0.75:0.5:28:0.22,flanger=delay=1.5:depth=1:speed=0.2:width=40,volume=1.5,alimiter=limit=0.95[v]`;
  ff([...inputs, '-filter_complex', `${delays};${mix}`, '-map', '[v]', '-ar', '44100', 'out/voice.wav']);
}
fs.writeFileSync('out/voice.json', JSON.stringify({ engine: useEleven ? 'elevenlabs' : 'piper', durations, total }));
console.log(`Voce (${useEleven ? 'ElevenLabs' : 'Piper'}): ${clips.length} frasi, durata totale ${total.toFixed(1)}s`);
