import { validateSettings } from './timeline.mjs';

export const PROPOSAL_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['settings', 'explanation'],
  properties: {
    settings: {
      type: 'object', additionalProperties: false,
      required: ['thresholdDb', 'minSilenceMs', 'preRollMs', 'postRollMs'],
      properties: {
        thresholdDb: { type: 'number', description: 'dBFS, -96 to 0 inclusive. Higher values remove louder sounds.' },
        minSilenceMs: { type: 'number', description: 'Continuous silence, 50 to 5000 milliseconds.' },
        preRollMs: { type: 'number', description: 'Keep 0 to 1000 ms before speech.' },
        postRollMs: { type: 'number', description: 'Keep 0 to 1000 ms after speech.' },
      },
    },
    explanation: { type: 'string', description: 'Brief Korean explanation, up to 800 characters. Do not claim to have listened to the video.' },
  },
};

export function validateProposal(value) {
  if (typeof value === 'string') {
    if (value.length > 16000) throw new Error('AI 응답이 너무 깁니다.');
    value = JSON.parse(value.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i, '$1'));
  }
  const exactKeys = (object, keys) => object && typeof object === 'object' && !Array.isArray(object) && Object.keys(object).length === keys.length && keys.every(key => Object.hasOwn(object, key));
  if (!exactKeys(value, ['settings', 'explanation']) || !exactKeys(value.settings, Object.keys(PROPOSAL_SCHEMA.properties.settings.properties))) throw new Error('허용된 편집 설정 형태의 응답이 아닙니다.');
  if (typeof value.explanation !== 'string' || !value.explanation.trim() || value.explanation.length > 800) throw new Error('AI 설명이 올바르지 않습니다.');
  return { settings: validateSettings(value.settings), explanation: value.explanation };
}

export function proposalPrompt(instruction, settings) {
  if (typeof instruction !== 'string' || !instruction.trim() || instruction.length > 2000) throw new Error('요청을 1~2,000자로 입력해 주세요.');
  const current = validateSettings(settings);
  return `You help set HyperCut silence editing controls. You have NOT received audio or video. Never claim to have analyzed media. Only suggest the four settings. No commands, file operations or other tasks. Return one JSON object matching the schema, with a brief Korean explanation. Preserve unspecified values. Be conservative about quiet speech. Higher thresholdDb removes louder sounds; increasing minSilenceMs preserves short pauses. preRollMs keeps sound before speech and postRollMs after speech. Respect the ranges in the schema.\nSchema: ${JSON.stringify(PROPOSAL_SCHEMA)}\nCurrent settings: ${JSON.stringify(current)}\nUser request: ${JSON.stringify(instruction)}`;
}
