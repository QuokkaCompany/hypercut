// Read only the Unicode cmap of the pinned OpenType files. Unsupported glyphs
// are an explicit edit error instead of an unnoticed tofu/fallback character.
export function fontHasCodePoint(bytes) {
  let cmap;
  for (let i = 0; i < bytes.readUInt16BE(4); i++) { const entry = 12 + i * 16; if (bytes.toString('ascii', entry, entry + 4) === 'cmap') cmap = bytes.readUInt32BE(entry + 8); }
  if (cmap === undefined) throw new Error('글꼴의 문자 정보를 읽을 수 없습니다.');
  const tables = [];
  for (let i = 0; i < bytes.readUInt16BE(cmap + 2); i++) {
    const entry = cmap + 4 + i * 8, platform = bytes.readUInt16BE(entry), encoding = bytes.readUInt16BE(entry + 2);
    if (platform === 0 || platform === 3 && [1, 10].includes(encoding)) { const offset = cmap + bytes.readUInt32BE(entry + 4), format = bytes.readUInt16BE(offset); if ([4, 12].includes(format)) tables.push({ offset, format }); }
  }
  return code => tables.some(({ offset, format }) => {
    if (format === 12) {
      let lo = 0, hi = bytes.readUInt32BE(offset + 12);
      while (lo < hi) { const mid = (lo + hi) >>> 1, group = offset + 16 + mid * 12, start = bytes.readUInt32BE(group), end = bytes.readUInt32BE(group + 4); if (code < start) hi = mid; else if (code > end) lo = mid + 1; else return bytes.readUInt32BE(group + 8) + code - start !== 0; }
      return false;
    }
    if (code > 0xffff) return false;
    const count = bytes.readUInt16BE(offset + 6) / 2, endBase = offset + 14, startBase = endBase + count * 2 + 2, deltaBase = startBase + count * 2, rangeBase = deltaBase + count * 2;
    for (let i = 0; i < count; i++) {
      if (code > bytes.readUInt16BE(endBase + i * 2)) continue;
      const start = bytes.readUInt16BE(startBase + i * 2); if (code < start) return false;
      const delta = bytes.readInt16BE(deltaBase + i * 2), range = bytes.readUInt16BE(rangeBase + i * 2);
      if (!range) return (code + delta & 0xffff) !== 0;
      const glyph = bytes.readUInt16BE(rangeBase + i * 2 + range + (code - start) * 2);
      return glyph !== 0 && (glyph + delta & 0xffff) !== 0;
    }
    return false;
  });
}
