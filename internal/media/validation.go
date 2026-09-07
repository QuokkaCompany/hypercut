package media

import (
	"fmt"
	"math"
	"regexp"
	"sort"
	"strings"
	"unicode/utf16"
)

var hashPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)
var clipPattern = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,80}$`)
var controls = regexp.MustCompile(`[\x00-\x08\x0b\x0c\x0e-\x1f]`)

func textLength(s string) int { return len(utf16.Encode([]rune(s))) }
func Language(v any, auto bool) bool {
	s := Str(v)
	return (auto && s == "auto") || strings.Contains("|ko|en|ja|zh|es|fr|de|pt|it|ru|", "|"+s+"|") && s != ""
}
func validText(v any) bool {
	s, ok := v.(string)
	return ok && strings.TrimSpace(s) != "" && textLength(s) <= 2000 && !controls.MatchString(s)
}
func cleanText(s string) string {
	s = strings.ReplaceAll(strings.ReplaceAll(s, "\r\n", "\n"), "\r", "\n")
	return strings.TrimSpace(regexp.MustCompile(`\n\s*\n`).ReplaceAllString(s, "\n"))
}
func Style(v any) (Object, error) {
	if v == nil {
		return Object{"enabled": false, "preset": "clean", "sizePercent": 4.5, "position": "bottom", "marginPercent": 8}, nil
	}
	o := Obj(v)
	_, ok := o["enabled"].(bool)
	if !ok || !one(Str(o["preset"]), "clean", "box", "emphasis") || !one(Str(o["position"]), "top", "bottom") || !between(o["sizePercent"], 2, 8) || !between(o["marginPercent"], 5, 20) {
		return nil, fmt.Errorf("자막 스타일 설정이 올바르지 않습니다.")
	}
	return Object{"enabled": o["enabled"], "preset": o["preset"], "position": o["position"], "sizePercent": o["sizePercent"], "marginPercent": o["marginPercent"]}, nil
}
func one(s string, values ...string) bool {
	for _, v := range values {
		if s == v {
			return true
		}
	}
	return false
}
func between(v any, a, b float64) bool { return finite(v) && Num(v) >= a && Num(v) <= b }
func Transcript(v any, d float64) (Object, error) {
	if v == nil {
		return nil, nil
	}
	o := Obj(v)
	if d <= 0 || !integer(o["trackIndex"]) || Num(o["trackIndex"]) < 0 || !integer(o["channel"]) || !between(o["channel"], 0, 7) || !Language(o["language"], true) {
		return nil, fmt.Errorf("전사 설정이 올바르지 않습니다.")
	}
	for _, k := range []string{"outputLanguage", "detectedLanguage"} {
		if x, ok := o[k]; ok && !Language(x, false) {
			return nil, fmt.Errorf("Invalid caption language")
		}
	}
	cues, ok := o["cues"].([]any)
	if !ok || len(cues) > 10000 {
		return nil, fmt.Errorf("Invalid caption count")
	}
	ids := map[string]bool{}
	out := []Object{}
	length := 0
	for _, x := range cues {
		c := Obj(x)
		id, ok := c["id"].(string)
		if !ok || textLength(id) > 100 || ids[id] {
			return nil, fmt.Errorf("Invalid caption ID")
		}
		ids[id] = true
		a, b := Num(c["start"]), Num(c["end"])
		if !between(c["start"], 0, d) || !between(c["end"], 0, d) || a >= b {
			return nil, fmt.Errorf("자막 시각이 영상 범위를 벗어났습니다.")
		}
		if !validText(c["text"]) {
			return nil, fmt.Errorf("자막 문구를 확인해 주세요.")
		}
		text := cleanText(Str(c["text"]))
		length += textLength(text)
		r := Object{"id": id, "start": a, "end": b, "text": text}
		if w, ok := c["timingWarning"]; ok {
			warning := Obj(w)
			if len(warning) != 2 || Str(warning["kind"]) != "source-end" || !between(warning["originalEnd"], d, d+30) || Num(warning["originalEnd"]) <= d {
				return nil, fmt.Errorf("Invalid timing warning")
			}
			r["timingWarning"] = warning
		}
		if v, ok := c["reviewedFor"]; ok {
			s, ok := v.(string)
			if !ok || textLength(s) > 65536 {
				return nil, fmt.Errorf("Invalid caption review")
			}
			if s != "" {
				r["reviewedFor"] = s
			}
		}
		if v, ok := c["translations"]; ok {
			entries, ok := v.(map[string]any)
			if !ok {
				return nil, fmt.Errorf("Invalid translations")
			}
			t := Object{}
			for lang, x := range entries {
				entry := Obj(x)
				if !Language(lang, false) || len(entry) != 2 || !validText(entry["text"]) || !validText(entry["sourceText"]) {
					return nil, fmt.Errorf("Invalid translation text")
				}
				translation := cleanText(Str(entry["text"]))
				t[lang] = Object{"text": translation, "sourceText": entry["sourceText"]}
				length += textLength(translation) + textLength(Str(entry["sourceText"]))
			}
			r["translations"] = t
		}
		out = append(out, r)
	}
	if length > 2*1024*1024 {
		return nil, fmt.Errorf("Too much caption text")
	}
	sort.SliceStable(out, func(i, j int) bool {
		if Num(out[i]["start"]) == Num(out[j]["start"]) {
			return Num(out[i]["end"]) < Num(out[j]["end"])
		}
		return Num(out[i]["start"]) < Num(out[j]["start"])
	})
	for i := 1; i < len(out); i++ {
		if Num(out[i]["start"]) < Num(out[i-1]["end"])-1e-6 {
			return nil, fmt.Errorf("자막 구간이 겹칩니다.")
		}
	}
	model := Str(o["model"])
	if _, ok := o["model"].(string); !ok || textLength(model) > 200 {
		model = "manual"
	}
	r := Object{"trackIndex": o["trackIndex"], "channel": o["channel"], "language": o["language"], "model": model, "cues": objects(out)}
	for _, k := range []string{"outputLanguage", "detectedLanguage"} {
		if x, ok := o[k]; ok {
			r[k] = x
		}
	}
	return r, nil
}
func Effects(v any, d float64) (Object, error) {
	if v == nil {
		return Object{"assets": []any{}, "clips": []any{}}, nil
	}
	o := Obj(v)
	assets, aok := o["assets"].([]any)
	clips, cok := o["clips"].([]any)
	if !aok || !cok || len(assets) > 32 || len(clips) > 128 {
		return nil, fmt.Errorf("Invalid effect limits")
	}
	registry := map[string]Object{}
	aa := []any{}
	for _, x := range assets {
		a := Obj(x)
		id := Str(a["id"])
		if !hashPattern.MatchString(id) || Str(a["fingerprint"]) != id || registry[id] != nil || strings.TrimSpace(Str(a["name"])) == "" || textLength(Str(a["name"])) > 255 || !between(a["duration"], .01, 300) {
			return nil, fmt.Errorf("Invalid effect asset")
		}
		r := Object{"id": id, "fingerprint": id, "name": a["name"], "duration": a["duration"]}
		registry[id] = r
		aa = append(aa, r)
	}
	ids := map[string]bool{}
	cc := []any{}
	for _, x := range clips {
		c := Obj(x)
		id := Str(c["id"])
		a := registry[Str(c["assetId"])]
		_, muted := c["muted"].(bool)
		if a == nil || !clipPattern.MatchString(id) || ids[id] || !muted || !between(c["start"], 0, d) || Num(c["start"]) >= d || !between(c["offset"], 0, Num(a["duration"])) || Num(c["offset"]) >= Num(a["duration"]) || !between(c["duration"], .01, 300) || !between(c["gainDb"], -60, 12) {
			return nil, fmt.Errorf("Invalid effect clip")
		}
		ids[id] = true
		r := Object{}
		for _, k := range []string{"id", "assetId", "start", "offset", "duration", "gainDb", "muted"} {
			r[k] = c[k]
		}
		cc = append(cc, r)
	}
	return Object{"assets": aa, "clips": cc}, nil
}
func ValidateJob(in, m Object) error {
	typ := Str(in["type"])
	if !one(typ, "analyze", "export", "preview", "restore", "transcribe", "captions", "transcript") {
		return fmt.Errorf("지원하지 않는 작업입니다.")
	}
	t, e := Track(m, in["trackIndex"])
	if e != nil {
		return e
	}
	d := Num(m["duration"])
	switch typ {
	case "analyze":
		if _, e = ValidateSettings(in["settings"]); e != nil {
			return e
		}
		_, e = SpeechSettings(in["speechProtection"])
	case "transcribe":
		s := Obj(in["transcription"])
		if !integer(s["channel"]) || !between(s["channel"], 0, Num(t["channels"])-1) || !Language(s["language"], true) {
			e = fmt.Errorf("전사할 언어와 오디오 채널을 선택해 주세요.")
		}
	default:
		cuts, ok := in["cuts"].([]any)
		if !ok || len(cuts) > 50000 {
			return fmt.Errorf("Invalid cuts")
		}
		for _, x := range cuts {
			c := Obj(x)
			_, ok := c["enabled"].(bool)
			if !ok || !between(c["start"], 0, d) || !between(c["end"], 0, d) || Num(c["end"]) <= Num(c["start"]) {
				return fmt.Errorf("Invalid cut range")
			}
		}
	}
	if e != nil {
		return e
	}
	if typ == "transcript" && !one(Str(in["textMode"]), "source", "edited") {
		return fmt.Errorf("Invalid transcript mode")
	}
	if one(typ, "captions", "transcript", "export", "preview") {
		style, err := Style(in["captionStyle"])
		if err != nil {
			return err
		}
		if _, err = Effects(in["effects"], d); err != nil {
			return err
		}
		if one(typ, "captions", "transcript") || Bool(style["enabled"]) {
			tr, err := Transcript(in["transcript"], d)
			if err != nil {
				return err
			}
			if tr == nil || Num(tr["trackIndex"]) != Num(in["trackIndex"]) {
				return fmt.Errorf("현재 오디오 트랙과 자막의 전사 트랙이 다릅니다.")
			}
		}
	}
	if r, ok := in["range"]; ok || typ == "restore" {
		w := Obj(r)
		if !one(typ, "restore", "preview", "export") || !between(w["start"], 0, d) || !between(w["end"], 0, d) || Num(w["start"]) >= Num(w["end"]) {
			return fmt.Errorf("Invalid source range")
		}
	}
	return nil
}
func MapEffects(e Object, kept []Span, window *Span) []Object {
	assets := map[string]Object{}
	for _, x := range Array(e["assets"]) {
		assets[Str(Obj(x)["id"])] = Obj(x)
	}
	out := []Object{}
	duration := Duration(kept)
	for _, x := range Array(e["clips"]) {
		c := Obj(x)
		if Bool(c["muted"]) {
			continue
		}
		cursor, anchor := 0.0, -1.0
		for _, s := range kept {
			if Num(c["start"]) >= s.Start && Num(c["start"]) < s.End {
				anchor = cursor + Num(c["start"]) - s.Start
				break
			}
			cursor += s.End - s.Start
		}
		if anchor < 0 {
			continue
		}
		end := math.Min(duration, math.Min(anchor+Num(c["duration"]), anchor+Num(assets[Str(c["assetId"])]["duration"])-Num(c["offset"])))
		first, last := 0.0, duration
		if window != nil {
			first, last = window.Start, window.End
		}
		from, to := math.Max(anchor, first), math.Min(end, last)
		if to > from {
			r := Copy(c)
			r["start"] = from - first
			r["offset"] = Num(c["offset"]) + from - anchor
			r["duration"] = to - from
			out = append(out, r)
		}
	}
	return out
}
