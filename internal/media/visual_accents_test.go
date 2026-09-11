package media

import (
	"bytes"
	"context"
	"math"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func accentFixture() (Object, Object) {
	a := Object{"id": "accent-a", "cueId": "a", "start": 1.0, "end": 3.0, "sourceText": "중요한 내용입니다.", "text": "중요한 내용입니다.", "language": "", "captionEnabled": true, "zoomEnabled": true, "zoomScale": 1.08, "focusX": 0.5, "focusY": 0.5}
	tr := Object{"trackIndex": 1.0, "channel": 0.0, "language": "ko", "cues": []any{Object{"id": "a", "start": 1.0, "end": 3.0, "text": "중요한 내용입니다."}}}
	return a, tr
}
func TestAccentMappingAndReview(t *testing.T) {
	a, tr := accentFixture()
	full := []Span{{0, 2}, {2.5, 4}}
	got, e := MapAccents([]Object{a}, tr, full, nil, true)
	if e != nil || len(got) != 2 || Num(got[0]["outputStart"]) != 1 || Num(got[0]["outputEnd"]) != 2 || Num(got[1]["outputStart"]) != 2 || Num(got[1]["outputEnd"]) != 2.5 {
		t.Fatalf("%v %v", got, e)
	}
	part, e := MapAccents([]Object{a}, tr, full, &Span{1.1, 1.5}, true)
	if e != nil || len(part) != 1 || math.Abs(Num(part[0]["outputStart"])+.1) > 1e-6 || math.Abs(Num(part[0]["outputEnd"])-.9) > 1e-6 {
		t.Fatalf("preview restarted easing: %v %v", part, e)
	}
	changed := Copy(a)
	changed["sourceText"] = "old"
	if _, e = MapAccents([]Object{changed}, tr, full, nil, true); e == nil {
		t.Fatal("stale effect accepted")
	}
	if empty, e := MapAccents([]Object{changed}, tr, []Span{{3, 4}}, nil, true); e != nil || len(empty) != 0 {
		t.Fatal("removed effect blocked export")
	}
	for _, patch := range []Object{{"zoomScale": 1.16}, {"focusX": -1.0}, {"captionEnabled": "true"}} {
		bad := Copy(a)
		for k, v := range patch {
			bad[k] = v
		}
		if _, e := VisualAccents([]any{bad}, 4); e == nil {
			t.Fatal("bad accent accepted")
		}
	}
	if _, e := VisualAccents([]any{a, a}, 4); e == nil {
		t.Fatal("duplicate accepted")
	}
}
func TestAccentRenderPreservesAudioAndPreviewClock(t *testing.T) {
	if testing.Short() {
		t.Skip("FFmpeg integration")
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	dir := t.TempDir()
	if evidence := os.Getenv("HYPERCUT_ACCENT_EVIDENCE"); evidence != "" {
		dir = evidence
		if e := os.MkdirAll(dir, 0700); e != nil {
			t.Fatal(e)
		}
	}
	root, _ := filepath.Abs("../..")
	file := filepath.Join(dir, "grid.mp4")
	_, e := Capture(ctx, "ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=c=white:s=320x180:r=30:d=4,drawgrid=w=40:h=30:t=2:c=black", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=4", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", file)
	if e != nil {
		t.Fatal(e)
	}
	m, e := Inspect(ctx, file, "grid.mp4", false)
	if e != nil {
		t.Fatal(e)
	}
	a, tr := accentFixture()
	tr["trackIndex"] = m["audioTracks"].([]any)[0].(map[string]any)["index"]
	base := Object{"type": "export", "trackIndex": tr["trackIndex"], "cuts": []any{}, "transcript": tr}
	plain, e := Execute(ctx, root, base, m, dir, nil, nil)
	if e != nil {
		t.Fatal(e)
	}
	in := Copy(base)
	in["visualAccents"] = []any{a}
	zoom, e := Execute(ctx, root, in, m, dir, nil, nil)
	if e != nil {
		t.Fatal(e)
	}
	audio := func(out Object) []byte {
		b, e := Capture(ctx, "ffmpeg", "-v", "error", "-i", Str(out["path"]), "-map", "0:a:0", "-f", "s16le", "-")
		if e != nil {
			t.Fatal(e)
		}
		return b
	}
	if !bytes.Equal(audio(plain), audio(zoom)) {
		t.Fatal("zoom changed audio")
	}
	frame := func(out Object, at string) []byte {
		b, e := Capture(ctx, "ffmpeg", "-v", "error", "-ss", at, "-i", Str(out["path"]), "-frames:v", "1", "-vf", "scale=320:180", "-pix_fmt", "gray", "-f", "rawvideo", "-")
		if e != nil {
			t.Fatal(e)
		}
		return b
	}
	unzoomed, zoomed := frame(plain, "1.5"), frame(zoom, "1.5")
	// x=40 grid line should move to approximately x=30 at 1.08x around center.
	if len(zoomed) != 320*180 {
		t.Fatal("output dimensions changed")
	}
	darkest := 27
	for x := 28; x <= 34; x++ {
		if zoomed[85*320+x] < zoomed[85*320+darkest] {
			darkest = x
		}
	}
	if math.Abs(float64(darkest)-30.4) > 2 || zoomed[85*320+darkest] > 80 || unzoomed[85*320+darkest] < 180 {
		t.Fatalf("expected grid around x=30.4, got darkest x=%d", darkest)
	}

	preview := Copy(in)
	preview["type"] = "preview"
	preview["range"] = Object{"start": 1.1, "end": 2.0}
	part, e := Execute(ctx, root, preview, m, dir, nil, nil)
	if e != nil {
		t.Fatal(e)
	}
	// At 0.1s into the preview we are 0.2s into the ramp, not 0.1s.
	p, q := frame(part, "0.1"), frame(zoom, "1.2")
	sum := 0.0
	for i := range p {
		sum += math.Abs(float64(p[i]) - float64(q[i]))
	}
	if sum/float64(len(p)) > 14 {
		t.Fatalf("preview clock mismatch MAE %.2f", sum/float64(len(p)))
	}
	in["captionStyle"] = Object{"enabled": true, "preset": "clean", "sizePercent": 5.0, "position": "bottom", "marginPercent": 8.0}
	captioned, e := Execute(ctx, root, in, m, dir, nil, nil)
	if e != nil {
		t.Fatal(e)
	}
	if Num(captioned["burnedCaptions"]) != 1 || Num(captioned["visualAccentSegments"]) != 1 {
		t.Fatal(captioned)
	}
	if bytes.Equal(frame(captioned, "1.5"), zoomed) {
		t.Fatal("emphasis caption absent")
	}
	cancelled, stop := context.WithCancel(ctx)
	stop()
	if _, e := Execute(cancelled, root, in, m, dir, nil, nil); e == nil {
		t.Fatal("cancelled render completed")
	}
}

func TestAccentVFRFramesAfterCuts(t *testing.T) {
	if testing.Short() {
		t.Skip("FFmpeg integration")
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	root, _ := filepath.Abs("../..")
	dir := t.TempDir()
	file := filepath.Join(dir, "vfr.mp4")
	_, e := Capture(ctx, "ffmpeg", "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=320x180:r=30:d=4", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=4", "-vf", "select='not(eq(mod(n,4),1))'", "-fps_mode", "vfr", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", file)
	if e != nil {
		t.Fatal(e)
	}
	m, e := Inspect(ctx, file, "vfr.mp4", false)
	if e != nil {
		t.Fatal(e)
	}
	a, tr := accentFixture()
	tr["trackIndex"] = Obj(Array(m["audioTracks"])[0])["index"]
	cuts := []any{Object{"id": "cut", "start": 1.5, "end": 2.2, "enabled": true}}
	base := Object{"type": "export", "trackIndex": tr["trackIndex"], "cuts": cuts, "transcript": tr}
	plain, e := Execute(ctx, root, base, m, dir, nil, nil)
	if e != nil {
		t.Fatal(e)
	}
	base["visualAccents"] = []any{a}
	zoom, e := Execute(ctx, root, base, m, dir, nil, nil)
	if e != nil {
		t.Fatal(e)
	}
	pts := func(out Object) []byte {
		b, e := Capture(ctx, "ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "frame=best_effort_timestamp_time", "-of", "csv=p=0", Str(out["path"]))
		if e != nil {
			t.Fatal(e)
		}
		return b
	}
	if !bytes.Equal(pts(plain), pts(zoom)) {
		t.Fatal("VFR frame count or timestamps changed")
	}
	if Num(zoom["visualAccentSegments"]) != 2 {
		t.Fatal("cut-crossing effect did not split")
	}
}
