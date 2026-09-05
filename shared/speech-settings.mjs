export const DEFAULT_SPEECH_PROTECTION = Object.freeze({ enabled: false, threshold: 0.5 });

export function validateSpeechProtection(input = DEFAULT_SPEECH_PROTECTION) {
  if (typeof input?.enabled !== 'boolean' || typeof input.threshold !== 'number' || !Number.isFinite(input.threshold) || input.threshold < 0.1 || input.threshold > 0.9) throw new Error('말소리 보호 설정이 올바르지 않습니다. 음성 감지 기준은 0.1~0.9입니다.');
  return { enabled: input.enabled, threshold: input.threshold };
}
