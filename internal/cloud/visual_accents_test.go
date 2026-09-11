package cloud

import (
	"context"
	"path/filepath"
	"testing"
)

func TestBridgePreservesV9AccentsAndLegacyProjects(t *testing.T) {
	root, _ := filepath.Abs("../..")
	bridge, e := StartBridge(context.Background(), root)
	if e != nil {
		t.Fatal(e)
	}
	defer bridge.Close()
	accent := object{"id": "accent-a", "cueId": "a", "start": 1.0, "end": 3.0, "sourceText": "이전 문장", "text": "이전 문장", "language": "", "captionEnabled": true, "zoomEnabled": true, "zoomScale": 1.08, "focusX": 0.5, "focusY": 0.5}
	data := object{"format": "hypercut-project", "version": 9.0, "media": object{"name": "fixture.mp4", "fingerprint": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "duration": 4.0}, "settings": object{"thresholdDb": -40.0, "minSilenceMs": 500.0, "preRollMs": 100.0, "postRollMs": 150.0}, "speechProtection": nil, "transcript": nil, "captionStyle": nil, "effects": nil, "glossary": "", "trackIndex": 1.0, "cuts": []any{}, "visualAccents": []any{accent}}
	asset := object{"name": "fixture.mp4", "fingerprint": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "duration": 4.0, "audioTracks": []any{object{"index": 1.0, "channels": 1.0, "sampleRate": 48000.0}}}
	// A deleted/changed cue does not prevent saving a recoverable project.
	value, e := bridge.Call(context.Background(), object{"op": "validate-project", "input": data, "media": asset})
	if e != nil {
		t.Fatal(e)
	}
	got := obj(value)
	if got["version"] != 9.0 || len(array(got["visualAccents"])) != 1 || obj(array(got["visualAccents"])[0])["text"] != "이전 문장" {
		t.Fatal(got)
	}
	for version := 1; version <= 8; version++ {
		data["version"] = float64(version)
		data["visualAccents"] = "ignored future field"
		value, e = bridge.Call(context.Background(), object{"op": "validate-project", "input": data, "media": asset})
		if e != nil || len(array(obj(value)["visualAccents"])) != 0 {
			t.Fatalf("legacy %d: %v %v", version, value, e)
		}
	}
	data["version"] = 9.0
	delete(data, "visualAccents")
	if _, e = bridge.Call(context.Background(), object{"op": "validate-project", "input": data, "media": asset}); e == nil {
		t.Fatal("missing v9 accents accepted")
	}
}
