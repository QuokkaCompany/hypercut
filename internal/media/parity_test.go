package media

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"
)

func normalized(v any) any { b, _ := json.Marshal(v); var out any; json.Unmarshal(b, &out); return out }
func TestBrowserTimelineCaptionParity(t *testing.T) {
	b, e := os.ReadFile("testdata/browser-contract.json")
	if e != nil {
		t.Fatal(e)
	}
	var cases []Object
	if e = json.Unmarshal(b, &cases); e != nil {
		t.Fatal(e)
	}
	for index, c := range cases {
		frames := []float64{}
		for _, f := range Array(c["frames"]) {
			frames = append(frames, Num(f))
		}
		d := Num(c["duration"])
		cuts := Cuts(spans(c["candidates"], false), Obj(c["settings"]), d, frames)
		same := func(name string, a, b any) {
			t.Helper()
			if !reflect.DeepEqual(normalized(a), normalized(b)) {
				t.Fatalf("case %d %s mismatch\ngot %s\nwant %s", index, name, jsonText(a), jsonText(b))
			}
		}
		same("cuts", cuts, c["cuts"])
		r, k, w, e := Plan(cuts, d, frames, c["range"])
		if e != nil {
			t.Fatal(e)
		}
		same("plan", Object{"removals": r, "kept": k, "sourceRange": w}, c["plan"])
		restored, e := Restore(cuts, Object{"start": 2.9, "end": 3.1}, d, frames)
		if e != nil {
			t.Fatal(e)
		}
		same("restore", restored, c["restored"])
		same("captions", MapCaptions(Obj(c["transcript"]), k), c["mapped"])
	}
}
