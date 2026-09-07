import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { makeProject, validateProject, DEFAULT_SETTINGS } from '../shared/timeline.mjs';
import { validateGlossary } from '../shared/glossary.mjs';
import { correctionPrompt, validateCorrectionRequest } from '../shared/caption-correction.mjs';
import { askCaptionCorrection } from './reference/server/ai.mjs';

const glossary = '캡컶 → 캡컷\n기술 용어: 무음 구간, Whisper\n\t띄어쓰기 참고';
const media = { name: 'fixture.mp4', fingerprint: 'a'.repeat(64), duration: 10 };
const transcript = { trackIndex: 1, channel: 0, language: 'ko', model: 'fixture', cues: [{ id: 'a', start: 1, end: 2, text: '캡컶 입니다.' }] };
const project = makeProject(media, DEFAULT_SETTINGS, 1, [{ id: 'cut', start: 3, end: 4, enabled: false }], { enabled: true, threshold: .4 }, transcript, { enabled: true, preset: 'box', sizePercent: 4.5, position: 'bottom', marginPercent: 8 }, undefined, glossary);
const input = { requestId: randomUUID(), instruction: '오타 교정', glossary, cues: [{ id: 'a', text: '캡컶 입니다.' }] };

test('project glossary round trip preserves exact terms and existing editing data', () => {
  const restored = validateProject(JSON.parse(JSON.stringify(project)));
  assert.equal(restored.version, 8); assert.equal(restored.glossary, glossary);
  for (const field of ['media', 'settings', 'speechProtection', 'transcript', 'captionStyle', 'effects']) assert.deepEqual(restored[field], project[field]);
  assert.equal(restored.cuts[0].enabled, false);
  assert.equal(makeProject(media, DEFAULT_SETTINGS, 1, []).glossary, '');
  assert.equal(validateGlossary('가'.repeat(2000)).length, 2000);
});

test('v1 through v5 migrate with an empty glossary even when unknown glossary data exists', () => {
  for (const version of [1, 2, 3, 4, 5]) {
    for (const value of [undefined, 'old unknown field', { injected: 'not a string' }]) {
      const migrated = validateProject({ ...project, version, glossary: value });
      assert.equal(migrated.version, 8); assert.equal(migrated.glossary, ''); assert.equal(migrated.cuts[0].enabled, false);
      assert.deepEqual(migrated.transcript, version >= 3 ? transcript : null);
    }
  }
});

test('invalid current-project glossaries fail without modifying the source project or calling a model', async () => {
  let calls = 0; const original = JSON.stringify(project);
  for (const value of [undefined, null, 1, [], {}, '가'.repeat(2001), 'bad\u0000value', '\u001b[31m', '\u007f']) {
    assert.throws(() => validateProject({ ...project, glossary: value }), /교정 용어/);
    await assert.rejects(askCaptionCorrection({ provider: 'openai', model: 'fixture', apiKey: 'fixture' }, { ...input, glossary: value }, { fetchImpl: async () => { calls++; throw new Error('must not call'); } }));
  }
  assert.equal(calls, 0); assert.equal(JSON.stringify(project), original);
});

test('only explicit request glossary is transmitted; temporary blank/override leaves project intact', () => {
  for (const selected of ['', glossary, '이번 요청만 사용']) {
    const request = validateCorrectionRequest({ ...input, glossary: selected, project });
    const data = JSON.parse(correctionPrompt(request).split('\nRequest: ').at(-1));
    assert.deepEqual(Object.keys(data).sort(), ['cues', 'glossary', 'instruction', 'requestId']);
    assert.equal(data.glossary, selected); assert.equal(data.project, undefined);
    assert.ok(!JSON.stringify(data).includes(media.fingerprint));
  }
  assert.equal(project.glossary, glossary); assert.deepEqual(project.transcript, transcript);
});
