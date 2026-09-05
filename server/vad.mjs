import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { SpeechWindows } from '../shared/speech.mjs';

const modelURL = new URL('../assets/models/silero_vad.onnx', import.meta.url);
const MODEL_SHA256 = '1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3';
export const VAD_MODEL = 'silero-vad-6.2.1';

export async function createSpeechDetector({ channels, threshold, duration, gain = 1, signal, modelPath = modelURL }) {
  if (!Number.isInteger(channels) || channels < 1 || channels > 8 || !(duration > 0) || !Number.isFinite(gain) || gain < 1 || gain > 100) throw new Error('음성 감지 입력 구성이 올바르지 않습니다.');
  signal?.throwIfAborted();
  let bytes;
  try { bytes = await readFile(modelPath); } catch { throw new Error('말소리 보호 모델을 찾을 수 없습니다. 앱 설치를 확인하거나 보호를 직접 끈 뒤 다시 분석해 주세요.'); }
  if (createHash('sha256').update(bytes).digest('hex') !== MODEL_SHA256) throw new Error('말소리 보호 모델이 손상됐습니다. 앱을 다시 설치해 주세요.');
  // This must precede the native library's initialization, including in Electron.
  process.env.ORT_DISABLE_TELEMETRY = '1';
  const ort = await import('onnxruntime-node');
  let session;
  try { session = await ort.InferenceSession.create(bytes, { executionProviders: ['cpu'], intraOpNumThreads: 1, interOpNumThreads: 1 }); }
  catch { throw new Error('로컬 말소리 보호 엔진을 시작할 수 없습니다. 앱 설치와 지원 환경을 확인해 주세요.'); }
  let state = new ort.Tensor('float32', new Float32Array(2 * channels * 128), [2, channels, 128]);
  let context = new Float32Array(channels * 64), pending = new Float32Array(channels * 512), fill = 0, position = 0;
  const windows = new SpeechWindows(threshold, channels);
  const sr = new ort.Tensor('int64', BigInt64Array.from([16000n]), []);
  async function infer() {
    signal?.throwIfAborted();
    const input = new Float32Array(channels * 576), nextContext = new Float32Array(channels * 64);
    for (let c = 0; c < channels; c++) {
      input.set(context.subarray(c * 64, (c + 1) * 64), c * 576);
      for (let i = 0; i < 512; i++) input[c * 576 + 64 + i] = pending[i * channels + c] * gain;
      nextContext.set(input.subarray(c * 576 + 512, (c + 1) * 576), c * 64);
    }
    const result = await session.run({ input: new ort.Tensor('float32', input, [channels, 576]), state, sr });
    signal?.throwIfAborted();
    if (!result.stateN || result.stateN.data.length !== 2 * channels * 128) throw new Error('음성 감지 모델 상태가 올바르지 않습니다.');
    windows.push(result.output?.data || [], position / 16000, Math.min(duration, (position + fill) / 16000));
    state = result.stateN; context = nextContext; position += fill; fill = 0; pending.fill(0);
  }
  return {
    async push(samples) {
      if (samples.length % channels) throw new Error('음성 감지 채널 경계가 맞지 않습니다.');
      for (let offset = 0; offset < samples.length;) {
        signal?.throwIfAborted();
        const count = Math.min(512 - fill, (samples.length - offset) / channels);
        pending.set(samples.subarray(offset, offset + count * channels), fill * channels);
        fill += count; offset += count * channels;
        if (fill === 512) await infer();
      }
    },
    async finish() { if (fill) await infer(); signal?.throwIfAborted(); return windows.finish(duration); },
    async close() { await session.release(); },
    get seconds() { return position / 16000; },
  };
}
