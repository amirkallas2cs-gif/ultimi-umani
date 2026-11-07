// Voce narrante di ULTIMA: legge il testo di ogni inquadratura e allunga le inquadrature
// quanto serve perché la frase finisca. Produce out/voice.wav (già effettata) e out/voice.json.
//
// Motore, in ordine: ElevenLabs (ELEVENLABS_API_KEY + ELEVENLABS_VOICE_ID),
// Gemini TTS di Google AI Studio (GEMINI_API_KEY), e come riserva Piper con la voce italiana "paola".
// Se il motore scelto fallisce, si ripiega su Piper e l'errore finisce nel Log di Notion.
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

// Come recita ULTIMA (si può cambiare con la variabile GEMINI_STYLE)
const GEMINI_STYLE = process.env.GEMINI_STYLE ||
  "Leggi in italiano come un'intelligenza artificiale che ha preso il controllo del mondo: voce calma, fredda, " +
  'lievemente ironica e sicura di sé, ritmo lento, pause brevi tra le frasi, mai urlare';

async function gemini(text, file) {
  const model = process.env.GEMINI_TTS_MODEL || 'gemini-3.1-flash-tts-preview';
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `${GEMINI_STYLE}: ${text}` }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: process.env.GEMINI_VOICE || 'Kore' } } },
      },
    }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${d.error?.message || 'risposta non valida'}`);
  const part = d.candidates?.[0]?.content?.parts?.find(p => p.inlineData?.data);
  if (!part) throw new Error('Gemini non ha restituito audio.');
  // PCM 16 bit, mono, 24 kHz
  fs.writeFileSync(file + '.pcm', Buffer.from(part.inlineData.data, 'base64'));
  ff(['-f', 's16le', '-ar', '24000', '-ac', '1', '-i', file + '.pcm', '-ac', '1', '-ar', '44100', file]);
}

function piper(text, file) {
  const model = process.env.PIPER_MODEL || 'pipeline/voices/it_IT-paola-medium.onnx';
  execFileSync('piper', ['--model', model, '--output_file', file + '.raw.wav', '--length_scale', '1.08', '--sentence_silence', '0.25'],
    { input: text, stdio: ['pipe', 'inherit', 'inherit'] });
  ff(['-i', file + '.raw.wav', '-ac', '1', '-ar', '44100', file]);
}

let engine = process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_VOICE_ID ? 'elevenlabs'
  : process.env.GEMINI_API_KEY ? 'gemini' : 'piper';
const speak = (text, file) => engine === 'elevenlabs' ? elevenlabs(text, file)
  : engine === 'gemini' ? gemini(text, file) : piper(text, file);

async function build() {
  const durations = [], clips = [];
  let start = 0;
  for (let i = 0; i < shots.length; i++) {
    const text = spoken(shots[i]);
    let d = base;
    if (text) {
      const file = `out/voice/v${String(i).padStart(2, '0')}.wav`;
      await speak(text, file);
      const len = probe(file);
      d = Math.max(base, LEAD + len + TAIL);
      clips.push({ file, at: start + LEAD });
    }
    durations.push(Number(d.toFixed(2)));
    start += d;
  }
  return { durations, clips };
}

let built;
try {
  built = await build();
} catch (e) {
  if (engine === 'piper') {
    await logNotion('Errore', `Giorno ${day}: voce narrante non generata`, e.message);
    console.error('Voce non generata, il video esce senza:', e.message);
    process.exit(0);
  }
  await logNotion('Errore', `Giorno ${day}: voce ${engine} non riuscita, uso Piper`, e.message);
  console.error(`Voce ${engine} non riuscita (${e.message}), ripiego su Piper.`);
  engine = 'piper';
  try { built = await build(); } catch (e2) {
    await logNotion('Errore', `Giorno ${day}: voce narrante non generata`, e2.message);
    process.exit(0);
  }
}
const { durations, clips } = built;

const total = durations.reduce((a, b) => a + b, 0);
if (clips.length) {
  // Allinea le frasi sulla timeline e dà alla voce il timbro di ULTIMA:
  // un po' più grave, eco corta metallica e un leggero flanger
  const inputs = clips.flatMap(c => ['-i', c.file]);
  const delays = clips.map((c, k) => `[${k}]adelay=${Math.round(c.at * 1000)}:all=1[d${k}]`).join(';');
  const mix = clips.map((_, k) => `[d${k}]`).join('') +
    `amix=inputs=${clips.length}:normalize=0,apad,atrim=0:${total.toFixed(2)},` +
    (engine === 'piper'
      ? `asetrate=44100*0.95,aresample=44100,atempo=1.0526,highpass=f=90,aecho=0.75:0.5:28:0.22,flanger=delay=1.5:depth=1:speed=0.2:width=40,volume=1.5,`
      : `highpass=f=80,aecho=0.8:0.4:24:0.12,flanger=delay=1:depth=0.6:speed=0.15:width=25,volume=1.3,`) +
    `alimiter=limit=0.95[v]`;
  ff([...inputs, '-filter_complex', `${delays};${mix}`, '-map', '[v]', '-ar', '44100', 'out/voice.wav']);
}
fs.writeFileSync('out/voice.json', JSON.stringify({ engine, durations, total }));
console.log(`Voce (${engine}): ${clips.length} frasi, durata totale ${total.toFixed(1)}s`);
