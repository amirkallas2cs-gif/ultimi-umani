// Taglia la registrazione e produce due MP4 9:16: Instagram (con musica) e TikTok (senza musica).
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const meta = JSON.parse(fs.readFileSync('out/meta.json', 'utf8'));
const ff = args => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });

ff(['-ss', String(meta.lead), '-i', 'out/raw.webm', '-t', String(meta.duration),
  '-vf', 'scale=1080:1920:flags=lanczos,fps=30',
  '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-an',
  '-movflags', '+faststart', 'out/tiktok.mp4']);

const tracks = fs.existsSync('pipeline/music')
  ? fs.readdirSync('pipeline/music').filter(f => /\.(mp3|m4a|wav)$/i.test(f))
  : [];
if (tracks.length) {
  const track = 'pipeline/music/' + tracks[meta.day % tracks.length];
  const fadeOut = Math.max(0, meta.duration - 1.5).toFixed(2);
  ff(['-i', 'out/tiktok.mp4', '-i', track, '-map', '0:v', '-map', '1:a', '-c:v', 'copy',
    '-af', `afade=t=in:d=1,afade=t=out:st=${fadeOut}:d=1.5,volume=0.8`,
    '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart', 'out/instagram.mp4']);
  console.log('Musica:', track);
} else {
  fs.copyFileSync('out/tiktok.mp4', 'out/instagram.mp4');
  console.log('Nessuna traccia in pipeline/music: il video Instagram esce senza musica.');
}
