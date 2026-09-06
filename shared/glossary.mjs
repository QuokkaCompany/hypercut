export const GLOSSARY_MAX_LENGTH = 2000;

/** Project and request glossaries share the same bounds. Empty text means no glossary. */
export function validateGlossary(value) {
  if (typeof value !== 'string' || value.length > GLOSSARY_MAX_LENGTH || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw new Error('교정 용어는 제어 문자 없이 2,000자 이내로 입력해 주세요.');
  return value;
}
