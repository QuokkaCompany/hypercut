package media

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"math"
	"strconv"
)

type Object = map[string]any

func Obj(v any) Object {
	if x, ok := v.(map[string]any); ok {
		return x
	}
	return Object{}
}
func Array(v any) []any {
	if x, ok := v.([]any); ok {
		return x
	}
	return nil
}
func Str(v any) string { s, _ := v.(string); return s }
func Num(v any) float64 {
	switch x := v.(type) {
	case float64:
		return x
	case int:
		return float64(x)
	case int64:
		return float64(x)
	case json.Number:
		n, _ := x.Float64()
		return n
	}
	return 0
}
func Bool(v any) bool { b, _ := v.(bool); return b }
func finite(v any) bool {
	switch v.(type) {
	case float64, int, int64, json.Number:
		n := Num(v)
		return !math.IsNaN(n) && !math.IsInf(n, 0)
	}
	return false
}
func integer(v any) bool { return finite(v) && math.Trunc(Num(v)) == Num(v) }
func Copy(v Object) Object {
	o := Object{}
	for k, x := range v {
		o[k] = x
	}
	return o
}
func ID() string {
	var b [16]byte
	if _, e := rand.Read(b[:]); e != nil {
		panic(e)
	}
	b[6] = (b[6] & 15) | 64
	b[8] = (b[8] & 63) | 128
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[:4], b[4:6], b[6:8], b[8:10], b[10:])
}
func number(n float64) string { return strconv.FormatFloat(n, 'f', -1, 64) }
func objects(v []Object) []any {
	a := make([]any, len(v))
	for i, x := range v {
		a[i] = x
	}
	return a
}
