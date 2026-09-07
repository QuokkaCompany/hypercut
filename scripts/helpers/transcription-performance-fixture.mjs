import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { capture } from '../../tests/reference/server/process.mjs';
import { inspectMedia, publicMedia } from '../../tests/reference/server/media.mjs';
const exec = promisify(execFile);
export async function sha256(file) { const hash = createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest('hex'); }
export async function transcriptionFixture(directory, seconds) {
  await mkdir(directory, { recursive: true });
  const manifestPath = path.join(directory, `${seconds}s.json`), previous = await readFile(manifestPath, 'utf8').then(JSON.parse).catch(() => null);
  const source = path.join(directory, `${seconds}s.mp4`);
  if (previous && await stat(source).catch(() => null) && await sha256(source) === previous.media.fingerprint) return { ...previous, source };
  const text = '오늘은 영상 편집의 순서를 살펴보겠습니다. 먼저 원본 파일을 열고 마이크의 소리를 확인합니다. 문장 사이의 긴 무음은 줄이고, 작은 목소리는 남겨 주세요. 자막의 숫자와 고유명사는 원본을 들으며 다시 확인합니다. 마지막으로 편집한 영상을 저장하고 처음부터 끝까지 재생합니다.';
  const speech = path.join(directory, 'korean.aiff'), cycle = path.join(directory, 'cycle-video.mp4'), audio = path.join(directory, 'cycle-audio.wav');
  await exec('/usr/bin/say', ['-v', 'Eddy (Korean (South Korea))', '-r', '175', '-o', speech, text]);
  const spokenSeconds = Number(JSON.parse(await capture('ffprobe', ['-v', 'error', '-show_format', '-of', 'json', speech])).format.duration), cycleSeconds = Math.ceil(spokenSeconds + 4);
  await capture('ffmpeg', ['-v', 'error', '-nostdin', '-f', 'lavfi', '-i', `color=c=0x243023:s=1920x1080:r=30:d=${cycleSeconds},drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable='between(mod(t,3.6),0.4,0.6)'`, '-an', '-t', String(cycleSeconds), '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18', '-pix_fmt', 'yuv420p', '-y', cycle]);
  await capture('ffmpeg', ['-v', 'error', '-nostdin', '-i', speech, '-af', 'adelay=1000,apad', '-t', String(cycleSeconds), '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', '-y', audio]);
  await capture('ffmpeg', ['-v', 'error', '-nostdin', '-stream_loop', '-1', '-i', cycle, '-stream_loop', '-1', '-i', audio, '-map', '0:v:0', '-map', '1:a:0', '-t', String(seconds), '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-y', source]);
  const media = publicMedia(await inspectMedia(source));
  if (Math.abs(media.duration - seconds) > 1 / 30 || media.width !== 1920 || media.height !== 1080 || media.fps !== 30 || media.audioTracks[0].sampleRate !== 48000) throw new Error('Long fixture does not match declared input');
  const result = { format: 'hypercut-transcription-benchmark-fixture', version: 1, kind: 'Repeated generated Korean TTS and simple 1080p video, not human quality evidence', text, voice: 'Eddy (Korean (South Korea))', rate: 175, spokenSeconds, cycleSeconds, speechSHA256: await sha256(speech), cycleSHA256: await sha256(cycle), audioSHA256: await sha256(audio), media };
  await writeFile(manifestPath, JSON.stringify(result, null, 2)); return { ...result, source };
}
