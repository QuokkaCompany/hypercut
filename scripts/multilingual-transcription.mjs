import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { capture } from '../server/process.mjs';
import { inspectMedia } from '../server/media.mjs';
import { transcribeMedia, TRANSCRIPTION_MODEL } from '../server/transcription.mjs';
const directory = await mkdtemp(path.join(os.tmpdir(), 'hypercut-multilingual-stt-'));
const report = { scope: 'Actual installed Whisper small on generated TTS, not human recording accuracy', model: TRANSCRIPTION_MODEL, runs: [] };
const samples = [
  { language: 'en', voice: 'Eddy (English (US))', text: 'We can create subtitles automatically. Keep the original video unchanged.', expected: /subtitles/i },
  { language: 'ja', voice: 'Eddy (Japanese (Japan))', text: '動画の字幕を自動で作成します。元の動画は変更しません。', expected: /字幕/ },
  { language: 'zh', voice: 'Eddy (Chinese (China mainland))', text: '我们可以自动生成中文字幕。请保留原始视频。', expected: /字幕/ },
];
try {
  for (const sample of samples) {
    const aiff = path.join(directory, `${sample.language}.aiff`), video = path.join(directory, `${sample.language}.mp4`);
    await capture('/usr/bin/say', ['-v', sample.voice, '-r', '160', '-o', aiff, sample.text]);
    await capture('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x334455:s=320x180:r=30', '-i', aiff, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-y', video]);
    const media = await inspectMedia(video), fingerprint = createHash('sha256').update(await readFile(video)).digest('hex');
    for (const language of sample.language === 'ja' ? ['ja', 'auto'] : [sample.language]) {
      const at = performance.now(), transcript = await transcribeMedia(media, 1, { language, channel: 0 }, directory), text = transcript.cues.map(c => c.text).join('');
      assert.match(text, sample.expected); assert.ok(transcript.cues.every(c => c.start >= 0 && c.end <= media.duration));
      if (language === 'auto') assert.equal(transcript.detectedLanguage, 'ja');
      assert.equal(createHash('sha256').update(await readFile(video)).digest('hex'), fingerprint);
      report.runs.push({ language, voice: sample.voice, sourceText: sample.text, sourceSHA256: fingerprint, seconds: (performance.now() - at) / 1000, transcript, status: 'PASS' });
      console.log(`${language}: ${text}`);
    }
  }
} finally { await mkdir('test-output/multilingual', { recursive: true }); await writeFile('test-output/multilingual/transcription.json', JSON.stringify(report, null, 2)); await rm(directory, { recursive: true, force: true }); }
