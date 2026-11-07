// Monta i fotogrammi in due MP4 9:16 a 30 fps:
// - tiktok.mp4: senza audio, per aggiungere il suono di tendenza a mano
// - instagram.mp4: con una traccia da pipeline/music, oppure con la colonna sonora d'atmosfera generata qui
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const meta = JSON.parse(fs.readFileSync('out/meta.json', 'utf8'));
const D = meta.duration.toFixed(2);
const fadeOut = Math.max(0, meta.duration - 1.5).toFixed(2);
const ff = args => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });

ff(['-framerate', String(meta.fps), '-i', 'out/frames/f%05d.jpg',
  '-vf', 'scale=1080:1920:flags=lanczos,format=yuv420p',
  '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', '-r', String(meta.fps),
  '-movflags', '+faststart', 'out/silent.mp4']);

const hasVoice = fs.existsSync('out/voice.wav');
// TikTok: solo voce narrante (il suono di tendenza si aggiunge nell'app)
if (hasVoice) {
  ff(['-i', 'out/silent.mp4', '-i', 'out/voice.wav', '-map', '0:v', '-map', '1:a', '-c:v', 'copy',
    '-c:a', 'aac', '-b:a', '160k', '-t', D, '-movflags', '+faststart', 'out/tiktok.mp4']);
} else {
  fs.copyFileSync('out/silent.mp4', 'out/tiktok.mp4');
}

// Musica sotto la voce: si abbassa da sola quando ULTIMA parla
const voiceMix = bed => hasVoice
  ? `${bed}[bed];[bed][vsc]sidechaincompress=threshold=0.04:ratio=6:attack=15:release=350[duck];[duck][vmix]amix=inputs=2:normalize=0,alimiter=limit=0.95[out]`
  : `${bed}[out]`;
const voiceIn = hasVoice ? ['-i', 'out/voice.wav'] : [];

const tracks = fs.existsSync('pipeline/music')
  ? fs.readdirSync('pipeline/music').filter(f => /\.(mp3|m4a|wav)$/i.test(f))
  : [];

if (tracks.length) {
  const track = 'pipeline/music/' + tracks[meta.day % tracks.length];
  const vIdx = 2;
  ff(['-i', 'out/silent.mp4', '-i', track, ...voiceIn, '-filter_complex',
    (hasVoice ? `[${vIdx}]asplit=2[vsc][vmix];` : '') +
    voiceMix(`[1]atrim=0:${D},afade=t=in:d=1,afade=t=out:st=${fadeOut}:d=1.5,volume=${hasVoice ? 0.55 : 0.8}`),
    '-map', '0:v', '-map', '[out]', '-c:v', 'copy',
    '-c:a', 'aac', '-b:a', '160k', '-t', D, '-movflags', '+faststart', 'out/instagram.mp4']);
  console.log('Musica:', track);
} else {
  // Colonna sonora d'atmosfera: bordone grave, vento filtrato e un segnale di ULTIMA a ogni cambio di inquadratura
  const S = Number(meta.shot_seconds) || 4.2;
  const blip = `aevalsrc='0.22*sin(2*PI*1320*t)*lt(mod(t\\,${S})\\,0.06)*gt(t\\,0.3)+0.12*sin(2*PI*1980*t)*between(mod(t\\,${S})\\,0.09\\,0.13)*gt(t\\,0.3)':s=44100:d=${D}`;
  ff(['-i', 'out/silent.mp4',
    '-f', 'lavfi', '-i', `sine=f=55:sample_rate=44100:d=${D}`,
    '-f', 'lavfi', '-i', `sine=f=82.41:sample_rate=44100:d=${D}`,
    '-f', 'lavfi', '-i', `anoisesrc=color=brown:amplitude=0.6:sample_rate=44100:d=${D}`,
    '-f', 'lavfi', '-i', blip,
    ...voiceIn,
    '-filter_complex',
    (hasVoice ? '[5]asplit=2[vsc][vmix];' : '') +
    `[1]volume=0.55,tremolo=f=0.18:d=0.5[a];` +
    `[2]volume=0.28,tremolo=f=0.27:d=0.7[b];` +
    `[3]lowpass=f=320,highpass=f=40,volume=0.35,tremolo=f=0.12:d=0.6[c];` +
    `[4]aecho=0.6:0.5:120:0.35[d];` +
    voiceMix(`[a][b][c][d]amix=inputs=4:normalize=0,afade=t=in:d=1.2,afade=t=out:st=${fadeOut}:d=1.5,volume=${hasVoice ? 1.6 : 2.4},alimiter=limit=0.9`),
    '-map', '0:v', '-map', '[out]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-t', D,
    '-movflags', '+faststart', 'out/instagram.mp4']);
  console.log("Nessuna traccia in pipeline/music: uso la colonna sonora d'atmosfera generata.");
}
