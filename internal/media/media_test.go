package media

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"
)

func settings() Object {
	return Object{"thresholdDb": float64(-40), "minSilenceMs": float64(500), "preRollMs": float64(100), "postRollMs": float64(150)}
}
func TestTimelineBoundaries(t *testing.T) {
	f := []float64{}
	for i := 0; i <= 300; i++ {
		f = append(f, float64(i)/30)
	}
	cuts := Cuts([]Span{{0, 1}, {2, 4}, {8, 10}}, settings(), 10, f)
	if len(cuts) != 3 {
		t.Fatal(cuts)
	}
	r, k, w, e := Plan(cuts, 10, f, Object{"start": float64(1), "end": float64(5)})
	if e != nil || w.Start != 1 || w.End != 5 || Duration(k) <= 0 || len(r) != 3 {
		t.Fatalf("%v %v %v %v", r, k, w, e)
	}
	a, b := Expressions([]Span{{83.0 / 30, 4}})
	if a == "" || b == "" {
		t.Fatal(a, b)
	}
}
func TestProposalCaptionReview(t *testing.T) {
	tr := Object{"trackIndex": float64(1), "channel": float64(0), "language": "ko", "cues": []any{Object{"id": "a", "start": float64(1), "end": float64(3), "text": "hello"}}}
	validated, e := Transcript(tr, 4)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = CaptionText(validated, []Span{{0, 2}}, ""); e == nil {
		t.Fatal("partial caption exported without review")
	}
	mapped := MapCaptions(validated, []Span{{0, 2}})
	Obj(Array(validated["cues"])[0])["reviewedFor"] = mapped[0]["reviewKey"]
	if _, e = CaptionText(validated, []Span{{0, 2}}, ""); e != nil {
		t.Fatal(e)
	}
	if _, e = Transcript(Object{"cues": []any{}}, 4); e == nil {
		t.Fatal("invalid transcript accepted")
	}
}
func TestNativeMediaPipeline(t *testing.T) {
	if testing.Short() {
		t.Skip("FFmpeg integration")
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	root, _ := filepath.Abs("../..")
	dir := t.TempDir()
	file := filepath.Join(dir, "sample.mp4")
	_, e := Capture(ctx, "ffmpeg", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30:duration=4", "-f", "lavfi", "-i", "aevalsrc='0.18*sin(2*PI*330*t)*between(t,1,3)':s=48000:d=4", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", file)
	if e != nil {
		t.Fatal(e)
	}
	m, e := Inspect(ctx, file, "sample.mp4", false)
	if e != nil {
		t.Fatal(e)
	}
	hash := m["fingerprint"]
	analysis, e := Analyze(ctx, root, m, settings(), float64(1), nil, nil)
	if e != nil {
		t.Fatal(e)
	}
	if len(Array(analysis["cuts"])) != 2 {
		t.Fatal(analysis["cuts"])
	}
	tr := Object{"trackIndex": float64(1), "channel": float64(0), "language": "en", "cues": []any{Object{"id": "a", "start": 1.0, "end": 2.0, "text": "Hello Go captions"}}}
	out, e := Execute(ctx, root, Object{"type": "export", "trackIndex": float64(1), "cuts": analysis["cuts"], "transcript": tr, "captionStyle": Object{"enabled": true, "preset": "box", "position": "bottom", "sizePercent": float64(5), "marginPercent": float64(8)}}, m, dir, nil, nil)
	if e != nil {
		t.Fatal(e)
	}
	if Num(out["burnedCaptions"]) != 1 || Num(out["duration"]) >= 4 {
		t.Fatal(out)
	}
	after, e := Hash(ctx, file)
	if e != nil || after != hash {
		t.Fatal("source changed")
	}
	for _, text := range []string{"자동 자막", "English captions", "動画の字幕", "自动生成中文字幕。", "Édition vidéo", "Русские субтитры"} {
		preview, e := RenderCaptions(ctx, root, Object{"mode": "sample", "text": text, "width": 640, "height": 360})
		if e != nil || preview["image"] == nil {
			t.Fatalf("%s: %v", text, e)
		}
	}
}
func TestActualSpeechAndTranscription(t *testing.T) {
	file := os.Getenv("HYPERCUT_GO_SPEECH_FIXTURE")
	if file == "" {
		t.Skip("Set HYPERCUT_GO_SPEECH_FIXTURE and native runtime for actual model acceptance")
	}
	root, _ := filepath.Abs("../..")
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	m, e := Inspect(ctx, file, "Synthetic speech.mp4", false)
	if e != nil {
		t.Fatal(e)
	}
	index := Obj(Array(m["audioTracks"])[0])["index"]
	analysis, e := Analyze(ctx, root, m, settings(), index, Object{"enabled": true, "threshold": .5}, nil)
	if e != nil {
		t.Fatal(e)
	}
	if len(Obj(analysis["protection"])["intervals"].([]Span)) == 0 {
		t.Fatal("No speech detected")
	}
	tr, e := Transcribe(ctx, root, m, index, Object{"channel": float64(0), "language": "en"}, t.TempDir(), nil)
	if e != nil {
		t.Fatal(e)
	}
	if len(Array(tr["cues"])) == 0 {
		t.Fatal("No transcript")
	}
	out, e := Execute(ctx, root, Object{"type": "export", "trackIndex": index, "cuts": []any{}, "transcript": tr, "captionStyle": Object{"enabled": true, "preset": "box", "position": "bottom", "sizePercent": float64(5), "marginPercent": float64(8)}}, m, t.TempDir(), nil, nil)
	if e != nil {
		t.Fatal(e)
	}
	t.Logf("Go-only actual VAD/Whisper/captions: %d cues, %v seconds", len(Array(tr["cues"])), out["duration"])
	b, _ := json.Marshal(out)
	if reflect.DeepEqual(b, []byte("null")) {
		t.Fatal("empty result")
	}
}
