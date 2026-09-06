// Language codes are accepted by the bundled whisper.cpp multilingual engine.
// Availability is distinct from measured recognition/translation quality.
export const CAPTION_LANGUAGES = Object.freeze([
  { code: 'ko', label: '한국어' }, { code: 'en', label: 'English · 영어' },
  { code: 'ja', label: '日本語 · 일본어' }, { code: 'zh', label: '中文 · 중국어' },
  { code: 'es', label: 'Español · 스페인어' }, { code: 'fr', label: 'Français · 프랑스어' },
  { code: 'de', label: 'Deutsch · 독일어' }, { code: 'pt', label: 'Português · 포르투갈어' },
  { code: 'it', label: 'Italiano · 이탈리아어' }, { code: 'ru', label: 'Русский · 러시아어' }
]);
export const isCaptionLanguage = value => CAPTION_LANGUAGES.some(language => language.code === value);
export const isTranscriptionLanguage = value => value === 'auto' || isCaptionLanguage(value);
export const languageLabel = value => value === 'auto' ? '자동 감지' : CAPTION_LANGUAGES.find(language => language.code === value)?.label || value;
