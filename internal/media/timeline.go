package media

import (
	"fmt"
	"math"
	"sort"
)

const eps = 1e-8

type Span struct {
	Start float64 `json:"start"`
	End   float64 `json:"end"`
}

func spans(v any, enabled bool) []Span {
	out := []Span{}
	for _, x := range Array(v) {
		o := Obj(x)
		if !enabled || Bool(o["enabled"]) {
			out = append(out, Span{Num(o["start"]), Num(o["end"])})
		}
	}
	return out
}
func ValidateSettings(v any) (Object, error) {
	o := Obj(v)
	r := Object{}
	for k, b := range map[string][2]float64{"thresholdDb": {-96, 0}, "minSilenceMs": {50, 5000}, "preRollMs": {0, 1000}, "postRollMs": {0, 1000}} {
		if !finite(o[k]) || Num(o[k]) < b[0] || Num(o[k]) > b[1] {
			return nil, fmt.Errorf("Invalid setting: %s", k)
		}
		r[k] = o[k]
	}
	return r, nil
}
func Normalize(a []Span, d float64) []Span {
	b := []Span{}
	for _, s := range a {
		s.Start = math.Max(0, s.Start)
		s.End = math.Min(d, s.End)
		if s.End > s.Start {
			b = append(b, s)
		}
	}
	sort.Slice(b, func(i, j int) bool { return b[i].Start < b[j].Start })
	r := []Span{}
	for _, s := range b {
		n := len(r)
		if n > 0 && s.Start <= r[n-1].End+eps {
			r[n-1].End = math.Max(r[n-1].End, s.End)
		} else {
			r = append(r, s)
		}
	}
	return r
}
func lower(a []float64, n float64) int {
	return sort.Search(len(a), func(i int) bool { return a[i] >= n-eps })
}
func frame(a []float64, i int, d float64) float64 {
	if i >= len(a) {
		return d
	}
	return a[max(0, i)]
}
func Snap(a []Span, d float64, f []float64) []Span {
	r := []Span{}
	for _, s := range Normalize(a, d) {
		begin := frame(f, lower(f, s.Start), d)
		i := lower(f, s.End)
		end := frame(f, i, d)
		if math.Abs(end-s.End) >= eps {
			end = frame(f, i-1, d)
		}
		if end-begin >= .1-eps {
			r = append(r, Span{begin, end})
		}
	}
	return r
}
func Cuts(a []Span, s Object, d float64, f []float64) []any {
	p := []Span{}
	for _, x := range Normalize(a, d) {
		if x.End-x.Start < Num(s["minSilenceMs"])/1000-eps {
			continue
		}
		if x.Start > eps {
			x.Start += Num(s["postRollMs"]) / 1000
		}
		if x.End < d-eps {
			x.End -= Num(s["preRollMs"]) / 1000
		}
		if x.End-x.Start >= .1-eps {
			p = append(p, x)
		}
	}
	r := []any{}
	for i, x := range Snap(p, d, f) {
		r = append(r, Object{"id": fmt.Sprintf("silence-%d-%.6f", i, x.Start), "start": x.Start, "end": x.End, "enabled": true, "reason": "silence"})
	}
	return r
}
func Kept(a []Span, d float64) []Span {
	r := []Span{}
	cursor := 0.0
	for _, x := range Normalize(a, d) {
		if x.Start > cursor+eps {
			r = append(r, Span{cursor, x.Start})
		}
		cursor = x.End
	}
	if cursor < d-eps {
		r = append(r, Span{cursor, d})
	}
	return r
}
func Duration(a []Span) float64 {
	d := 0.0
	for _, s := range a {
		d += s.End - s.Start
	}
	return d
}
func Plan(c any, d float64, f []float64, w any) ([]Span, []Span, *Span, error) {
	r := Snap(spans(c, true), d, f)
	var window *Span
	if w != nil {
		o := Obj(w)
		a, b := Num(o["start"]), Num(o["end"])
		if !finite(o["start"]) || !finite(o["end"]) || a < 0 || b > d || a >= b {
			return nil, nil, nil, fmt.Errorf("Invalid source range")
		}
		i := lower(f, a)
		start := frame(f, i, d)
		if start > a+eps {
			start = frame(f, i-1, d)
		}
		end := frame(f, lower(f, b), d)
		window = &Span{start, end}
		if start > 0 {
			r = append(r, Span{0, start})
		}
		if end < d {
			r = append(r, Span{end, d})
		}
		r = Normalize(r, d)
	}
	return r, Kept(r, d), window, nil
}
func Restore(c any, w Object, d float64, f []float64) ([]any, error) {
	_, _, s, e := Plan([]any{}, d, f, w)
	if e != nil {
		return nil, e
	}
	ids := map[string]bool{}
	for _, v := range Array(c) {
		ids[Str(Obj(v)["id"])] = true
	}
	seq := 0
	next := func() string {
		for {
			n := fmt.Sprintf("restore-%d", seq)
			seq++
			if !ids[n] {
				ids[n] = true
				return n
			}
		}
	}
	r := []any{}
	for _, v := range Array(c) {
		o := Obj(v)
		a, b := Num(o["start"]), Num(o["end"])
		if !Bool(o["enabled"]) || b <= s.Start || a >= s.End {
			r = append(r, Copy(o))
			continue
		}
		left, right := math.Max(a, s.Start), math.Min(b, s.End)
		if left-a < .1-eps {
			left = a
		}
		if b-right < .1-eps {
			right = b
		}
		add := func(x, y float64, on bool) {
			p := Copy(o)
			p["id"] = next()
			p["start"] = x
			p["end"] = y
			p["enabled"] = on
			if !on {
				p["reason"] = "manual"
			}
			r = append(r, p)
		}
		if left > a {
			add(a, left, true)
		}
		add(left, right, false)
		if right < b {
			add(right, b, true)
		}
	}
	if len(r) > 50000 {
		return nil, fmt.Errorf("Too many edit ranges")
	}
	return r, nil
}
func expression(p, v []float64, name string) string {
	if len(v) == 1 {
		return number(v[0])
	}
	mid := (len(v) - 1) / 2
	return fmt.Sprintf("if(lt(%s,round(%s/TB)),%s,%s)", name, number(p[mid]), expression(p[:mid], v[:mid+1], name), expression(p[mid+1:], v[mid+1:], name))
}
func Expressions(r []Span) (string, string) {
	p := []float64{}
	v := []float64{1}
	o := []float64{0}
	total := 0.0
	for _, s := range r {
		p = append(p, s.Start, s.End)
		v = append(v, 0, 1)
		o = append(o, total, total+s.End-s.Start)
		total += s.End - s.Start
	}
	return expression(p, v, "pts"), expression(p, o, "PTS")
}
