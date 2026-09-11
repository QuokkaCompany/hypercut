package media

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"golang.org/x/image/font"
	"golang.org/x/image/font/opentype"
	"golang.org/x/image/font/sfnt"
	"golang.org/x/image/math/fixed"
	"golang.org/x/text/unicode/norm"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"math"
	"os"
	"path/filepath"
	"strings"
	"unicode"
)

type layout struct {
	lines                                               []string
	size, lineHeight, padding, boxWidth, boxHeight, top float64
	face                                                font.Face
	public                                              Object
}

func (l *layout) close() { l.face.Close() }
func loadFont(ctx context.Context, root string, style Object, multilingual bool) (*opentype.Font, error) {
	dir := os.Getenv("HYPERCUT_CAPTION_FONT_DIR")
	if dir == "" {
		dir = filepath.Join(root, "assets/fonts")
	}
	b, e := os.ReadFile(filepath.Join(root, "assets/fonts/manifest.json"))
	if e != nil {
		return nil, e
	}
	var manifest Object
	if e = json.Unmarshal(b, &manifest); e != nil {
		return nil, e
	}
	alias := "HyperCut Regular"
	if Str(style["preset"]) != "clean" {
		alias = "HyperCut Bold"
	}
	if multilingual {
		alias += " Multilingual"
	}
	for _, x := range Array(manifest["files"]) {
		f := Obj(x)
		if Str(f["alias"]) != alias {
			continue
		}
		if e = ctx.Err(); e != nil {
			return nil, e
		}
		data, e := os.ReadFile(filepath.Join(dir, Str(f["file"])))
		if e != nil {
			return nil, fmt.Errorf("자막 글꼴 파일이 없습니다.")
		}
		digest := sha256.Sum256(data)
		if hex.EncodeToString(digest[:]) != Str(f["sha256"]) {
			return nil, fmt.Errorf("자막 글꼴이 손상됐습니다.")
		}
		return opentype.Parse(data)
	}
	return nil, fmt.Errorf("Caption font missing from manifest")
}
func tokens(text string) []string {
	out := []string{}
	var b strings.Builder
	flush := func() {
		if b.Len() > 0 {
			out = append(out, b.String())
			b.Reset()
		}
	}
	for _, r := range text {
		if unicode.IsSpace(r) || unicode.Is(unicode.Han, r) || unicode.Is(unicode.Hiragana, r) || unicode.Is(unicode.Katakana, r) {
			flush()
			out = append(out, string(r))
		} else {
			b.WriteRune(r)
		}
	}
	flush()
	return out
}
func measure(f *opentype.Font, raw string, w, h int, s Object) (*layout, error) {
	text := strings.ReplaceAll(norm.NFC.String(raw), "\t", "    ")
	var buf sfnt.Buffer
	for _, r := range text {
		if r == '\n' {
			continue
		}
		i, e := f.GlyphIndex(&buf, r)
		if e != nil || i == 0 {
			return nil, fmt.Errorf("지원하지 않는 자막 문자가 있습니다: %c", r)
		}
	}
	size := float64(min(w, h)) * Num(s["sizePercent"]) / 100
	minimum := float64(min(w, h)) * .02
	for {
		face, e := opentype.NewFace(f, &opentype.FaceOptions{Size: size, DPI: 72, Hinting: font.HintingNone})
		if e != nil {
			return nil, e
		}
		width := func(t string) float64 { return float64(font.MeasureString(face, t)) / 64 }
		maxWidth := float64(w)*.9 - size
		lines := []string{}
		for _, paragraph := range strings.Split(text, "\n") {
			line := ""
			for _, token := range tokens(paragraph) {
				segments := []string{token}
				if width(token) > maxWidth {
					segments = nil
					for _, r := range token {
						segments = append(segments, string(r))
					}
				}
				for _, segment := range segments {
					if width(line+segment) > maxWidth && line != "" {
						lines = append(lines, strings.TrimRightFunc(line, unicode.IsSpace))
						line = strings.TrimLeftFunc(segment, unicode.IsSpace)
					} else {
						line += segment
					}
				}
			}
			lines = append(lines, line)
		}
		if len(lines) > 3 {
			face.Close()
			if size <= minimum {
				return nil, fmt.Errorf("자막이 너무 깁니다. 문장을 나누거나 짧게 수정해 주세요.")
			}
			size = math.Max(minimum, size*.85)
			continue
		}
		lineHeight, padding := size*1.5, size*.4
		boxWidth := 0.0
		for _, line := range lines {
			boxWidth = math.Max(boxWidth, width(line))
		}
		boxWidth += padding * 2
		boxHeight := float64(len(lines))*lineHeight + padding*2
		top := float64(h) * Num(s["marginPercent"]) / 100
		if Str(s["position"]) == "bottom" {
			top = float64(h)*(1-Num(s["marginPercent"])/100) - boxHeight
		}
		if top < 0 || top+boxHeight > float64(h) || boxWidth > float64(w)*.91 {
			face.Close()
			return nil, fmt.Errorf("자막이 안전 영역을 벗어납니다.")
		}
		return &layout{lines, size, lineHeight, padding, boxWidth, boxHeight, top, face, Object{"lines": len(lines), "sizePercent": size / float64(min(w, h)) * 100, "bounds": Object{"x": (float64(w) - boxWidth) / 2, "y": top, "width": boxWidth, "height": boxHeight}}}, nil
	}
}
func paint(l *layout, w, h, offset int, s Object) ([]byte, error) {
	im := image.NewRGBA(image.Rect(0, 0, w, h))
	if Str(s["preset"]) == "box" || Bool(s["accent"]) {
		r := image.Rect(int((float64(w)-l.boxWidth)/2), int(l.top)-offset, int((float64(w)+l.boxWidth)/2), int(l.top+l.boxHeight)-offset)
		draw.Draw(im, r, image.NewUniform(color.NRGBA{17, 17, 17, 221}), image.Point{}, draw.Over)
	}
	fill := color.NRGBA{255, 255, 255, 255}
	if Str(s["preset"]) == "emphasis" || Bool(s["accent"]) {
		fill = color.NRGBA{255, 225, 107, 255}
	}
	for i, line := range l.lines {
		x := (float64(w) - float64(font.MeasureString(l.face, line))/64) / 2
		y := l.top + l.padding + l.lineHeight*(float64(i)+.75) - float64(offset)
		drawText := func(dx, dy float64, c color.Color) {
			d := font.Drawer{Dst: im, Src: image.NewUniform(c), Face: l.face, Dot: fixed.Point26_6{X: fixed.Int26_6(math.Round((x + dx) * 64)), Y: fixed.Int26_6(math.Round((y + dy) * 64))}}
			d.DrawString(line)
		}
		if Str(s["preset"]) != "box" {
			radius := math.Max(.5, l.size*.075) / 2
			for j := 0; j < 12; j++ {
				a := float64(j) * math.Pi / 6
				drawText(math.Cos(a)*radius, math.Sin(a)*radius, color.NRGBA{0, 0, 0, 238})
			}
		}
		drawText(0, 0, fill)
	}
	var b bytes.Buffer
	e := png.Encode(&b, im)
	return b.Bytes(), e
}
func RenderCaptions(ctx context.Context, root string, in Object) (Object, error) {
	s, e := Style(in["style"])
	if e != nil {
		return nil, e
	}
	w, h := int(Num(in["width"])), int(Num(in["height"]))
	if !integer(in["width"]) || !integer(in["height"]) || w < 2 || h < 2 || w*h > 36*1024*1024 {
		return nil, fmt.Errorf("Invalid caption canvas")
	}
	f, e := loadFont(ctx, root, s, false)
	if e != nil {
		return nil, e
	}
	sample := Str(in["mode"]) == "sample"
	texts := []string{}
	cues := Array(in["cues"])
	if sample {
		texts = append(texts, Str(in["text"]))
	} else {
		for _, x := range cues {
			texts = append(texts, Str(Obj(x)["text"]))
		}
	}
	var fallback *opentype.Font
	var accentFont, accentFallback *opentype.Font
	styles := []Object{}
	layouts := []*layout{}
	defer func() {
		for _, l := range layouts {
			l.close()
		}
	}()
	for i, text := range texts {
		current := s
		if !sample && Bool(Obj(cues[i])["accent"]) {
			current = Copy(s)
			current["preset"] = "box"
			current["accent"] = true
		}
		styles = append(styles, current)
		if e = ctx.Err(); e != nil {
			return nil, e
		}
		selected := f
		if Bool(current["accent"]) {
			if accentFont == nil {
				accentFont, e = loadFont(ctx, root, current, false)
				if e != nil {
					return nil, e
				}
			}
			selected = accentFont
		}
		var buf sfnt.Buffer
		for _, r := range norm.NFC.String(text) {
			if unicode.IsSpace(r) {
				continue
			}
			index, err := selected.GlyphIndex(&buf, r)
			if err != nil || index == 0 {
				fallbackSlot := &fallback
				if Bool(current["accent"]) {
					fallbackSlot = &accentFallback
				}
				if *fallbackSlot == nil {
					*fallbackSlot, e = loadFont(ctx, root, current, true)
					if e != nil {
						return nil, e
					}
				}
				selected = *fallbackSlot
				break
			}
		}
		l, e := measure(selected, text, w, h, current)
		if e != nil {
			return nil, e
		}
		layouts = append(layouts, l)
	}
	if sample {
		b, e := paint(layouts[0], w, h, 0, s)
		if e != nil {
			return nil, e
		}
		if len(b) > 4*1024*1024 {
			return nil, fmt.Errorf("Caption preview too large")
		}
		return Object{"image": "data:image/png;base64," + base64.StdEncoding.EncodeToString(b), "layout": layouts[0].public}, nil
	}
	offset, bottom := h, 0
	for _, l := range layouts {
		offset = min(offset, int(math.Floor((l.top-l.size*.25)/2)*2))
		bottom = max(bottom, int(math.Ceil((l.top+l.boxHeight+l.size*.25)/2)*2))
	}
	offset = max(0, offset)
	bottom = min(h, bottom)
	if len(layouts) == 0 {
		offset, bottom = 0, 2
	}
	height := max(2, bottom-offset)
	dir := Str(in["directory"])
	blank := image.NewRGBA(image.Rect(0, 0, w, height))
	var b bytes.Buffer
	if e = png.Encode(&b, blank); e != nil {
		return nil, e
	}
	if e = writeNew(filepath.Join(dir, "caption-blank.png"), b.Bytes()); e != nil {
		return nil, e
	}
	public := []any{}
	for i, l := range layouts {
		if e = ctx.Err(); e != nil {
			return nil, e
		}
		data, e := paint(l, w, height, offset, styles[i])
		if e != nil {
			return nil, e
		}
		if e = writeNew(filepath.Join(dir, fmt.Sprintf("caption-%d.png", i)), data); e != nil {
			return nil, e
		}
		public = append(public, l.public)
	}
	type event struct {
		at    int64
		index int
	}
	events := []event{{0, -1}}
	put := func(at int64, index int) {
		last := &events[len(events)-1]
		if last.at == at {
			last.index = index
		} else if last.index != index {
			events = append(events, event{at, index})
		}
	}
	end := int64(math.Round(Num(in["duration"]) * 1e6))
	previous := int64(0)
	for i, x := range cues {
		c := Obj(x)
		a, b := int64(math.Round(Num(c["start"])*1e6)), int64(math.Round(Num(c["end"])*1e6))
		if a < previous || b <= a || b > end {
			return nil, fmt.Errorf("Invalid caption event times")
		}
		put(a, i)
		put(b, -1)
		previous = b
	}
	put(end, -1)
	if events[len(events)-1].at != end {
		events = append(events, event{end, -1})
	}
	var script strings.Builder
	script.WriteString("ffconcat version 1.0\n")
	for i, event := range events {
		name := "blank"
		if event.index >= 0 {
			name = fmt.Sprint(event.index)
		}
		fmt.Fprintf(&script, "file 'caption-%s.png'\noption framerate 1000000\n", name)
		if i < len(events)-1 {
			fmt.Fprintf(&script, "duration %.6f\n", float64(events[i+1].at-event.at)/1e6)
		}
	}
	if e = writeNew(filepath.Join(dir, "captions.ffconcat"), []byte(script.String())); e != nil {
		return nil, e
	}
	return Object{"cueCount": len(cues), "layouts": public, "offsetY": offset, "imageHeight": height}, nil
}
func writeNew(file string, b []byte) error {
	f, e := os.OpenFile(file, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if e != nil {
		return e
	}
	_, e = f.Write(b)
	if e == nil {
		e = f.Sync()
	}
	closeErr := f.Close()
	if e == nil {
		e = closeErr
	}
	if e != nil {
		os.Remove(file)
	}
	return e
}
