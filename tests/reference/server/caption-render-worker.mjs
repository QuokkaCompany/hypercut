import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCaptionStyle, captionImageEvents } from '../../../shared/caption-style.mjs';
import { fontHasCodePoint } from './font-coverage.mjs';
process.env.DISABLE_SYSTEM_FONTS_LOAD = '1';
process.once('message', async input => {
  try {
    const { createCanvas, GlobalFonts } = await import('@napi-rs/canvas');
    const fontDirectory = input.fontDirectory || fileURLToPath(new URL('../../../assets/fonts/', import.meta.url));
    const manifest = JSON.parse(await readFile(new URL('../../../assets/fonts/manifest.json', import.meta.url), 'utf8'));
    const style = validateCaptionStyle(input.style), { width, height } = input;
    const selectedFont = style.preset === 'clean' ? 'HyperCut Regular' : 'HyperCut Bold';
    const texts = input.mode === 'sample' ? [input.text] : input.cues.map(cue => cue.text);
    const coverage = new Map();
    for (const font of manifest.files) {
      if (font.alias.endsWith(' Multilingual')) {
        if (font.alias !== `${selectedFont} Multilingual`) continue;
        const primary = coverage.get(selectedFont);
        if (texts.every(text => [...text.normalize('NFC')].every(c => c === '\n' || c === '\t' || primary(c.codePointAt(0))))) continue;
      }
      let bytes;
      try { bytes = await readFile(path.join(fontDirectory, font.file)); } catch { throw new Error('자막 글꼴 파일이 없습니다. 글꼴을 포함한 앱을 다시 설치해 주세요.'); }
      if (createHash('sha256').update(bytes).digest('hex') !== font.sha256) throw new Error('자막 글꼴이 손상됐습니다. 글꼴을 포함한 앱을 다시 설치해 주세요.');
      if (!GlobalFonts.register(bytes, font.alias)) throw new Error('자막 글꼴을 사용할 수 없습니다.');
      coverage.set(font.alias, fontHasCodePoint(bytes));
    }
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2 || width * height > 36 * 1024 ** 2) throw new Error('자막을 합성할 영상 크기가 지원 범위를 벗어났습니다.');
    let canvas = createCanvas(width, height), context = canvas.getContext('2d');
    const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    const words = new Intl.Segmenter(input.language || 'ko', { granularity: 'word' });
    const font = selectedFont;
    const supported = codePoint => coverage.get(font)(codePoint) || (coverage.get(`${font} Multilingual`)?.(codePoint) || false);
    const fontStack = `"${font}", "${font} Multilingual"`;
    function linesFor(text, size) {
      context.font = `${size}px ${fontStack}`;
      const maxWidth = width * .9 - size, lines = [];
      for (const paragraph of text.split('\n')) {
        let line = '';
        // Prefer intact words. Split only a token that cannot fit a whole line.
        const segments = [...words.segment(paragraph)].flatMap(({ segment }) => context.measureText(segment).width > maxWidth ? [...graphemes.segment(segment)].map(item => item.segment) : [segment]);
        for (const segment of segments) {
          if (context.measureText(line + segment).width > maxWidth && line) { lines.push(line.trimEnd()); line = segment.trimStart(); if (lines.length >= 3) return null; }
          else line += segment;
        }
        lines.push(line); if (lines.length > 3) return null;
      }
      return lines;
    }
    function layoutFor(raw) {
      const text = raw.normalize('NFC').replace(/\t/g, '    ');
      const unsupported = [...new Set([...text].filter(character => character !== '\n' && !supported(character.codePointAt(0))))];
      if (unsupported.length) throw new Error(`지원하지 않는 자막 문자가 있습니다: ${unsupported.slice(0, 5).join(' ')}. 문구를 수정해 주세요.`);
      let size = Math.min(width, height) * style.sizePercent / 100, lines;
      const minimum = Math.min(width, height) * .02;
      for (;;) { lines = linesFor(text, size); if (lines) break; if (size <= minimum) throw new Error('자막이 너무 깁니다. 문장을 나누거나 짧게 수정해 주세요.'); size = Math.max(minimum, size * .85); }
      const lineHeight = size * 1.5, padding = size * .4, boxWidth = Math.max(...lines.map(line => context.measureText(line).width)) + padding * 2;
      const boxHeight = lines.length * lineHeight + padding * 2;
      const top = style.position === 'top' ? height * style.marginPercent / 100 : height * (1 - style.marginPercent / 100) - boxHeight;
      if (top < 0 || top + boxHeight > height || boxWidth > width * .91) throw new Error('자막이 안전 영역을 벗어납니다. 크기나 문구를 줄여 주세요.');
      // Keep the box and actual glyph ink, including stroke and antialiasing.
      // Layout stays in the original video coordinates when the image is cropped.
      const edge = 2 + (style.preset === 'box' ? 0 : Math.max(.5, size * .075) / 2);
      let inkTop = top, inkBottom = top + boxHeight;
      for (let i = 0; i < lines.length; i++) {
        const metrics = context.measureText(lines[i]), y = top + padding + lineHeight * (i + .75);
        inkTop = Math.min(inkTop, y - metrics.actualBoundingBoxAscent - edge);
        inkBottom = Math.max(inkBottom, y + metrics.actualBoundingBoxDescent + edge);
      }
      return { size, lines, lineHeight, padding, boxWidth, boxHeight, top, inkTop, inkBottom,
        layout: { lines: lines.length, sizePercent: size / Math.min(width, height) * 100, bounds: { x: (width - boxWidth) / 2, y: top, width: boxWidth, height: boxHeight } } };
    }
    async function paint(measured) {
      const { size, lines, lineHeight, padding, boxWidth, boxHeight, top } = measured;
      context.clearRect(0, 0, width, height);
      context.font = `${size}px ${fontStack}`;
      if (style.preset === 'box') { context.fillStyle = '#111111dd'; context.beginPath(); context.roundRect((width - boxWidth) / 2, top, boxWidth, boxHeight, size * .2); context.fill(); }
      context.textAlign = 'center'; context.textBaseline = 'alphabetic'; context.lineJoin = 'round'; context.lineWidth = Math.max(.5, size * .075); context.strokeStyle = '#000000ee'; context.fillStyle = style.preset === 'emphasis' ? '#ffe16b' : '#ffffff';
      for (let i = 0; i < lines.length; i++) { const y = top + padding + lineHeight * (i + .75); if (style.preset !== 'box') context.strokeText(lines[i], width / 2, y); context.fillText(lines[i], width / 2, y); }
      return { png: await canvas.encode('png'), layout: measured.layout };
    }
    let result;
    if (input.mode === 'sample') {
      const image = await paint(layoutFor(input.text));
      if (image.png.length > 4 * 1024 ** 2) throw new Error('자막 미리보기 이미지가 너무 큽니다.');
      result = { image: `data:image/png;base64,${image.png.toString('base64')}`, layout: image.layout };
    } else {
      const measured = input.cues.map(cue => layoutFor(cue.text));
      const offsetY = measured.length ? Math.max(0, Math.floor(Math.min(...measured.map(item => item.inkTop)) / 2) * 2) : 0;
      const bottom = measured.length ? Math.min(height, Math.ceil(Math.max(...measured.map(item => item.inkBottom)) / 2) * 2) : 2;
      const imageHeight = Math.max(2, bottom - offsetY);
      canvas = createCanvas(width, imageHeight); context = canvas.getContext('2d');
      context.translate(0, -offsetY);
      context.clearRect(0, 0, width, height); await writeFile(path.join(input.directory, 'caption-blank.png'), await canvas.encode('png'), { flag: 'wx' });
      const layouts = [];
      for (let i = 0; i < input.cues.length; i++) {
        const image = await paint(measured[i]); await writeFile(path.join(input.directory, `caption-${i}.png`), image.png, { flag: 'wx' }); layouts.push(image.layout);
        process.send?.({ type: 'progress', value: (i + 1) / Math.max(1, input.cues.length) });
      }
      const events = captionImageEvents(input.cues, input.duration);
      const concat = 'ffconcat version 1.0\n' + events.map((event, i) => `file 'caption-${event.index < 0 ? 'blank' : event.index}.png'\noption framerate 1000000\n${i < events.length - 1 ? `duration ${event.duration.toFixed(6)}\n` : ''}`).join('');
      await writeFile(path.join(input.directory, 'captions.ffconcat'), concat, { flag: 'wx' }); result = { cueCount: input.cues.length, layouts, offsetY, imageHeight };
    }
    process.send?.({ type: 'result', result }, () => process.exit(0));
  } catch (error) { process.send?.({ type: 'error', error: error.message }, () => process.exit(1)); }
});
