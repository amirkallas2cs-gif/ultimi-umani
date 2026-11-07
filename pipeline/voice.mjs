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

// Due voci: "narratore" e "ultima". Nel copione ogni inquadratura ha "voice" (chi parla),
// oppure "say" come elenco di battute [{ "voice": "narratore", "text": "..." }, { "voice": "ultima", "text": "..." }].
// Senza indicazioni parla il narratore. Testo: "say" se c'è, altrimenti il sottotitolo senza formattazione.
const clean = t => String(t || '').replace(/\*\*|!!/g, '').replace(/\s*\n\s*/g, ' ').replace(/[«»"]/g, '').trim();
const role = v => (String(v || '').toLowerCase().startsWith('ult') ? 'ultima' : 'narratore');
const lines = sh => Array.isArray(sh.say)
  ? sh.say.map(l => ({ voice: role(l.voice), text: clean(l.text) })).filter(l => l.text)
  : [{ voice: role(sh.voice), text: clean(sh.say || sh.cap) }].filter(l => l.text);

async function elevenlabs(text, file, who) {
  const vid = who === 'narratore' ? (process.env.ELEVENLABS_VOICE_ID_NARRATORE || process.env.ELEVENLABS_VOICE_ID) : process.env.ELEVENLABS_VOICE_ID;
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${vid}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.6, similarity_boost: 0.75 } }),
  });
  if (!r.ok) throw new Error(`ElevenLabs ${r.status}: ${(await r.text()).slice(0, 200)}`);
  fs.writeFileSync(file + '.mp3', Buffer.from(await r.arrayBuffer()));
  ff(['-i', file + '.mp3', '-ac', '1', '-ar', '44100', file]);
}

// Come recita ULTIMA (si può cambiare con la variabile GEMINI_STYLE)
const STYLE_NARRATORE = process.env.GEMINI_STYLE_NARRATORE ||
  'Leggi in italiano come il narratore di un film: voce profonda e controllata, tono grave e misterioso, ' +
  'ritmo calmo con pause drammatiche, pronuncia italiana standard e neutra, nessun accento regionale';
const GEMINI_STYLE = process.env.GEMINI_STYLE ||
  "Leggi in italiano come una voce sintetica di un'intelligenza artificiale: robotica, fredda, piatta e monotona, " +
  'senza emozioni e senza calore umano, articolazione precisa, ritmo sostenuto e veloce, pause minime tra le frasi. ' +
  'Pronuncia italiana standard e neutra, dizione da doppiatore, nessun accento o inflessione regionale';

// Effetto voce di ULTIMA, scelto con la variabile VOICE_FX:
//   android        voce sintetica monotona e grave, con risonanza metallica (predefinito)
//   sintetizzatore monotona più acuta, con chorus da sintetizzatore
//   dalek          modulazione ad anello: il classico robot "da film"
//   glitch         robot disturbato, con bit crusher e tremolio
//   retro          computer anni '80: banda stretta e campionamento grezzo
//   umana          nessun effetto
// Velocità senza cambiare il tono: VOICE_SPEED per ULTIMA (default 1.12), VOICE_SPEED_NARRATORE (default 1.0).
const clampSp = (v, d) => Math.min(1.6, Math.max(0.8, Number(v) || d));
const SPEED = { ultima: clampSp(process.env.VOICE_SPEED, 1.12), narratore: clampSp(process.env.VOICE_SPEED_NARRATORE, 1.0) };
const ROBOT_CORE = ov => `afftfilt=real='hypot(re,im)':imag='0':win_size=1024:overlap=${ov}`;
const PRESET_FX = sp => ({
  android: `[0]atempo=${sp},${ROBOT_CORE(0.57)},highpass=f=120,aecho=0.8:0.6:6:0.45,volume=1.4[o]`,
  sintetizzatore: `[0]atempo=${sp},${ROBOT_CORE(0.71)},highpass=f=150,chorus=0.6:0.8:20|28:0.4|0.3:0.25|0.4:2|1.5,volume=1.4[o]`,
  dalek: `[0]atempo=${sp},volume=1.6[v];[v][1]amultiply,acrusher=bits=8:mix=0.25:mode=log,highpass=f=150,volume=1.6[o]`,
  glitch: `[0]atempo=${sp},${ROBOT_CORE(0.57)},acrusher=bits=6:samples=3:mix=0.55:mode=log,tremolo=f=16:d=0.35,highpass=f=120,volume=1.4[o]`,
  retro: `[0]atempo=${sp},${ROBOT_CORE(0.8)},highpass=f=400,lowpass=f=3500,acrusher=bits=8:samples=4:mix=0.7,volume=1.8[o]`,
  umana: `[0]atempo=${sp}[o]`,
});
const PRESETS = PRESET_FX(1);

const pickFx = (v, d) => (PRESETS[v] ? v : d);
const FX = {
  ultima: pickFx(process.env.VOICE_FX_ULTIMA || process.env.VOICE_FX, 'sintetizzatore'),
  narratore: pickFx(process.env.VOICE_FX_NARRATORE, 'umana'),
};
function applyFx(inFile, outFile, preset, who = 'ultima') {
  ff(['-i', inFile, '-f', 'lavfi', '-i', 'sine=f=40:sample_rate=44100',
    '-filter_complex', PRESET_FX(SPEED[who])[preset], '-map', '[o]', '-t', '60', '-ar', '44100', '-ac', '1', outFile]);
}

// Livello gratuito: massimo 3 richieste al minuto. Una richiesta ogni 21 secondi,
// e se Google chiede di aspettare si aspetta il tempo indicato e si riprova.
const GEMINI_GAP = Number(process.env.GEMINI_GAP_SECONDS || 21) * 1000;
let lastGemini = 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function gemini(text, file, who) {
  for (let attempt = 1; ; attempt++) {
    const wait = lastGemini + GEMINI_GAP - Date.now();
    if (lastGemini && wait > 0) await sleep(wait);
    lastGemini = Date.now();
    try { return await geminiOnce(text, file, who); } catch (e) {
      if (e.status !== 429 || attempt >= 5) throw e;
      const secs = Number((/retry in ([\d.]+)s/i.exec(e.message) || [])[1]) || 30;
      console.log(`Gemini: quota al minuto raggiunta, riprovo tra ${Math.ceil(secs)}s`);
      await sleep((secs + 1) * 1000);
    }
  }
}

async function geminiOnce(text, file, who) {
  const style = who === 'narratore' ? STYLE_NARRATORE : GEMINI_STYLE;
  const voice = who === 'narratore' ? (process.env.GEMINI_VOICE_NARRATORE || process.env.GEMINI_VOICE || 'Kore') : (process.env.GEMINI_VOICE || 'Kore');
  const model = process.env.GEMINI_TTS_MODEL || 'gemini-3.1-flash-tts-preview';
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `${style}: ${text}` }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { languageCode: 'it-IT', voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
      },
    }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(`Gemini ${r.status}: ${d.error?.message || 'risposta non valida'}`), { status: r.status });
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
const speak = (text, file, who) => engine === 'elevenlabs' ? elevenlabs(text, file, who)
  : engine === 'gemini' ? gemini(text, file, who) : piper(text, file);

const GAP = 0.3; // pausa tra due battute nella stessa inquadratura
async function build() {
  const durations = [], clips = [];
  let start = 0;
  for (let i = 0; i < shots.length; i++) {
    const ls = lines(shots[i]);
    let offset = 0;
    for (let j = 0; j < ls.length; j++) {
      const file = `out/voice/v${String(i).padStart(2, '0')}-${j}.wav`;
      const raw = file.replace(/\.wav$/, '.base.wav');
      await speak(ls[j].text, raw, ls[j].voice);
      applyFx(raw, file, FX[ls[j].voice], ls[j].voice);
      const len = probe(file);
      clips.push({ file, raw, voice: ls[j].voice, at: start + LEAD + offset });
      offset += len + GAP;
    }
    const d = ls.length ? Math.max(base, LEAD + offset - GAP + TAIL) : base;
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

// Allinea le frasi sulla timeline della durata del video
function mixTimeline(files, out) {
  const inputs = files.flatMap(f => ['-i', f]);
  const delays = clips.map((c, k) => `[${k}]adelay=${Math.round(c.at * 1000)}:all=1[d${k}]`).join(';');
  const mix = clips.map((_, k) => `[d${k}]`).join('') +
    `amix=inputs=${clips.length}:normalize=0,apad,atrim=0:${total.toFixed(2)},highpass=f=60,volume=1.2,alimiter=limit=0.95[v]`;
  ff([...inputs, '-filter_complex', `${delays};${mix}`, '-map', '[v]', '-ar', '44100', out]);
}

if (clips.length) {
  mixTimeline(clips.map(c => c.file), 'out/voice.wav');
  // Prova: la stessa registrazione con tutti gli effetti, per sceglierne uno ascoltando
  if (process.env.VOICE_TEST_PRESETS) {
    for (const preset of Object.keys(PRESETS)) {
      const files = clips.map((c, k) => {
        if (c.voice === 'narratore') return c.file;
        const f = `out/voice/p-${preset}-${k}.wav`; applyFx(c.raw, f, preset); return f;
      });
      mixTimeline(files, `out/prova-${preset}.wav`);
      console.log('Prova pronta:', `prova-${preset}.wav`);
    }
  }
}
fs.writeFileSync('out/voice.json', JSON.stringify({ engine, fx: FX, durations, total }));
const nU = clips.filter(c => c.voice === 'ultima').length;
console.log(`Voce (${engine}): ${clips.length - nU} battute del narratore (${FX.narratore}), ${nU} di ULTIMA (${FX.ultima}), durata ${total.toFixed(1)}s`);
