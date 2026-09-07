package media

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"strings"
)

func jsonText(v any) string {
	var b bytes.Buffer
	e := json.NewEncoder(&b)
	e.SetEscapeHTML(false)
	_ = e.Encode(v)
	return strings.NewReplacer(`\u2028`, "\u2028", `\u2029`, "\u2029").Replace(strings.TrimSuffix(b.String(), "\n"))
}
func CaptionContent(c Object, lang string) (string, bool) {
	if lang == "" {
		return Str(c["text"]), false
	}
	t := Obj(Obj(c["translations"])[lang])
	text := Str(t["text"])
	if text == "" {
		text = Str(c["text"])
	}
	return text, t["sourceText"] != c["text"]
}
func MapCaptions(t Object, kept []Span) []Object {
	out := []Object{}
	for _, x := range Array(t["cues"]) {
		c := Obj(x)
		text, missing := CaptionContent(c, Str(t["outputLanguage"]))
		a, b := Num(c["start"]), Num(c["end"])
		parts := [][2]float64{}
		cursor, retained, start, end := 0.0, 0.0, 0.0, 0.0
		for _, s := range kept {
			from, to := math.Max(a, s.Start), math.Min(b, s.End)
			if to > from {
				if len(parts) == 0 {
					start = cursor + from - s.Start
				}
				end = cursor + to - s.Start
				parts = append(parts, [2]float64{from, to})
				retained += to - from
			}
			cursor += s.End - s.Start
		}
		key := []any{a, b, text, parts}
		if w, ok := c["timingWarning"]; ok {
			key = append(key, w)
		}
		if lang := Str(t["outputLanguage"]); lang != "" {
			key = append(key, lang, c["text"])
		}
		review := jsonText(key)
		r := Copy(c)
		r["text"] = text
		r["translationMissing"] = missing
		r["removed"] = len(parts) == 0
		r["outputStart"] = start
		r["outputEnd"] = end
		if len(parts) == 0 {
			delete(r, "outputStart")
			delete(r, "outputEnd")
		}
		r["reviewKey"] = review
		r["needsReview"] = len(parts) > 0 && (missing || ((math.Abs(retained-(b-a)) > 1e-6 || c["timingWarning"] != nil) && Str(c["reviewedFor"]) != review))
		out = append(out, r)
	}
	return out
}
func stamp(t float64) string {
	ms := int64(math.Round(t * 1000))
	return fmt.Sprintf("%02d:%02d:%02d,%03d", ms/3600000, ms/60000%60, ms/1000%60, ms%1000)
}
func CaptionText(t Object, kept []Span, mode string) (string, error) {
	cues := MapCaptions(t, kept)
	if mode == "source" {
		cues = []Object{}
		for _, x := range Array(t["cues"]) {
			c := Copy(Obj(x))
			text, missing := CaptionContent(c, Str(t["outputLanguage"]))
			c["text"] = text
			c["translationMissing"] = missing
			cues = append(cues, c)
		}
	}
	lines := []string{}
	for _, c := range cues {
		if Bool(c["removed"]) {
			continue
		}
		if Bool(c["needsReview"]) || Bool(c["translationMissing"]) {
			return "", fmt.Errorf("출력할 자막의 문구와 경계를 먼저 검토해 주세요.")
		}
		text := Str(c["text"])
		if mode != "" {
			lines = append(lines, text)
			continue
		}
		a, b := Num(c["outputStart"]), Num(c["outputEnd"])
		if math.Round(b*1000) <= math.Round(a*1000) {
			return "", fmt.Errorf("1ms보다 짧은 자막 구간을 조절해 주세요.")
		}
		text = strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;").Replace(text)
		lines = append(lines, fmt.Sprintf("%d\n%s --> %s\n%s", len(lines)+1, stamp(a), stamp(b), text))
	}
	if len(lines) == 0 {
		return "", fmt.Errorf("내보낼 자막이 없습니다.")
	}
	return strings.Join(lines, "\n\n") + "\n", nil
}
func CaptionCues(t Object, full, kept []Span) ([]Object, error) {
	review := map[string]Object{}
	for _, c := range MapCaptions(t, full) {
		review[Str(c["id"])] = c
	}
	out := []Object{}
	for _, c := range MapCaptions(t, kept) {
		if Bool(c["removed"]) {
			continue
		}
		if Bool(review[Str(c["id"])]["needsReview"]) {
			return nil, fmt.Errorf("출력할 자막의 문구와 경계를 먼저 검토해 주세요.")
		}
		out = append(out, Object{"start": c["outputStart"], "end": c["outputEnd"], "text": c["text"]})
	}
	return out, nil
}
