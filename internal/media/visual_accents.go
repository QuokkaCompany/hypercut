package media

import (
	"fmt"
	"math"
	"sort"
)

// VisualAccents validates stored snapshots without requiring their cues to still exist.
// Stale snapshots remain saveable; only affected renders require review.
func VisualAccents(v any, duration float64) ([]Object, error) {
	if v == nil {
		return []Object{}, nil
	}
	values, ok := v.([]any)
	if !ok || len(values) > 200 {
		return nil, fmt.Errorf("강조는 최대 200개까지 저장할 수 있습니다.")
	}
	ids, cues := map[string]bool{}, map[string]bool{}
	out := []Object{}
	for _, value := range values {
		a := Obj(value)
		id, cue := Str(a["id"]), Str(a["cueId"])
		_, cueOK := a["cueId"].(string)
		_, capOK := a["captionEnabled"].(bool)
		_, zoomOK := a["zoomEnabled"].(bool)
		lang, langOK := a["language"].(string)
		if !validText(a["id"]) || textLength(id) > 100 || ids[id] || !cueOK || textLength(cue) > 100 || cues[cue] || !validText(a["sourceText"]) || !validText(a["text"]) || !langOK || (lang != "" && !Language(lang, false)) || !between(a["start"], 0, duration) || !between(a["end"], 0, duration) || Num(a["end"]) <= Num(a["start"]) || !capOK || !zoomOK || !between(a["zoomScale"], 1, 1.15) || !between(a["focusX"], 0, 1) || !between(a["focusY"], 0, 1) {
			return nil, fmt.Errorf("강조 설정·문장·시간 범위를 확인해 주세요.")
		}
		ids[id], cues[cue] = true, true
		clean := Object{}
		for _, k := range []string{"id", "cueId", "sourceText", "text", "language", "start", "end", "captionEnabled", "zoomEnabled", "zoomScale", "focusX", "focusY"} {
			clean[k] = a[k]
		}
		out = append(out, clean)
	}
	sort.SliceStable(out, func(i, j int) bool { return Num(out[i]["start"]) < Num(out[j]["start"]) })
	for i := 1; i < len(out); i++ {
		if Num(out[i]["start"]) < Num(out[i-1]["end"]) {
			return nil, fmt.Errorf("강조 구간이 겹칩니다.")
		}
	}
	return out, nil
}
func AccentNeedsReview(a, tr Object) bool {
	for _, x := range Array(tr["cues"]) {
		c := Obj(x)
		if c["id"] != a["cueId"] {
			continue
		}
		text, missing := CaptionContent(c, Str(tr["outputLanguage"]))
		return missing || a["sourceText"] != c["text"] || a["text"] != text || a["language"] != Str(tr["outputLanguage"]) || Num(a["start"]) != Num(c["start"]) || Num(a["end"]) != Num(c["end"])
	}
	return true
}

// Full kept intervals define the animation clock. A preview clips that clock rather
// than restarting its easing at the preview boundary.
func MapAccents(accents []Object, tr Object, full []Span, window *Span, captions bool) ([]Object, error) {
	out := []Object{}
	for _, a := range accents {
		if !Bool(a["zoomEnabled"]) && !(captions && Bool(a["captionEnabled"])) {
			continue
		}
		cursor := 0.0
		for _, s := range full {
			start, end := math.Max(Num(a["start"]), s.Start), math.Min(Num(a["end"]), s.End)
			if end > start {
				from, to := cursor+start-s.Start, cursor+end-s.Start
				visible := window == nil || (to > window.Start && from < window.End)
				if visible {
					if AccentNeedsReview(a, tr) {
						return nil, fmt.Errorf("강조한 문장이 변경됐습니다. 강조 창에서 다시 연결하거나 제거해 주세요.")
					}
					r := Copy(a)
					if window != nil {
						from -= window.Start
						to -= window.Start
					}
					r["outputStart"], r["outputEnd"] = from, to
					r["sourcePartStart"], r["sourcePartEnd"] = start, end
					out = append(out, r)
				}
			}
			cursor += s.End - s.Start
		}
	}
	if len(out) > 1000 {
		return nil, fmt.Errorf("강조 구간이 너무 많이 나뉩니다. 강조를 줄여 주세요.")
	}
	return out, nil
}

// Precompute transforms against actual retained frame timestamps (including VFR).
// Perspective evaluates these once per frame and keeps a fixed canvas. Dynamically
// resizing scale/crop leaves crop's input geometry stale in FFmpeg.
type accentTransform struct {
	frame                    int
	left, top, right, bottom float64
}

func transformAt(parts []Object, at float64) accentTransform {
	for _, a := range parts {
		start, end := Num(a["outputStart"]), Num(a["outputEnd"])
		if at < start || at >= end || !Bool(a["zoomEnabled"]) {
			continue
		}
		ramp := math.Min(.25, (end-start)/2)
		u := math.Max(0, math.Min(1, math.Min((at-start)/ramp, (end-at)/ramp)))
		z := 1 + (Num(a["zoomScale"])-1)*u*u*(3-2*u)
		width := 1 / z
		left := math.Max(0, math.Min(1-width, Num(a["focusX"])-width/2))
		top := math.Max(0, math.Min(1-width, Num(a["focusY"])-width/2))
		return accentTransform{left: left, top: top, right: left + width, bottom: top + width}
	}
	return accentTransform{right: 1, bottom: 1}
}
func transformExpression(values []accentTransform, value func(accentTransform) float64) string {
	if len(values) == 1 {
		return number(value(values[0]))
	}
	i := len(values) / 2
	return fmt.Sprintf("if(lt(in,%d),%s,%s)", values[i].frame, transformExpression(values[:i], value), transformExpression(values[i:], value))
}
func AccentZoomFilter(parts []Object, frames []float64, kept []Span) string {
	zooms := []Object{}
	for _, a := range parts {
		if Bool(a["zoomEnabled"]) && Num(a["zoomScale"]) > 1 && lower(frames, Num(a["sourcePartEnd"]))-lower(frames, Num(a["sourcePartStart"])) > 1 {
			zooms = append(zooms, a)
		}
	}
	parts = zooms
	hasZoom := false
	for _, a := range parts {
		hasZoom = hasZoom || (Bool(a["zoomEnabled"]) && Num(a["zoomScale"]) > 1)
	}
	if !hasZoom {
		return ""
	}
	values := []accentTransform{}
	cursor := 0.0
	index := 0
	for _, s := range kept {
		for i := lower(frames, s.Start); i < len(frames) && frames[i] < s.End-eps; i++ {
			v := transformAt(parts, cursor+frames[i]-s.Start)
			v.frame = index
			index++
			if len(values) > 0 {
				last := values[len(values)-1]
				if math.Abs(v.left-last.left) < 1e-12 && math.Abs(v.top-last.top) < 1e-12 && math.Abs(v.right-last.right) < 1e-12 && math.Abs(v.bottom-last.bottom) < 1e-12 {
					continue
				}
			}
			values = append(values, v)
		}
		cursor += s.End - s.Start
	}
	if len(values) == 0 {
		return ""
	}
	left := transformExpression(values, func(v accentTransform) float64 { return v.left })
	top := transformExpression(values, func(v accentTransform) float64 { return v.top })
	right := transformExpression(values, func(v accentTransform) float64 { return v.right })
	bottom := transformExpression(values, func(v accentTransform) float64 { return v.bottom })
	return fmt.Sprintf(",perspective=x0='W*(%s)':y0='H*(%s)':x1='W*(%s)':y1='H*(%s)':x2='W*(%s)':y2='H*(%s)':x3='W*(%s)':y3='H*(%s)':sense=source:eval=frame:interpolation=linear", left, top, right, top, left, bottom, right, bottom)
}
