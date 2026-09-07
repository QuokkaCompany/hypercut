package media

import (
	"bytes"
	"context"
	"math"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestIndependentFlashBeepSync(t *testing.T) {
	if testing.Short() {
		t.Skip("FFmpeg sync integration")
	}
	for _, variant := range []string{"cfr", "vfr", "offset"} {
		t.Run(variant, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
			defer cancel()
			root, _ := filepath.Abs("../..")
			dir := t.TempDir()
			file := filepath.Join(dir, "source.mp4")
			flash := `color=c=black:s=160x90:r=30:d=12,drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable='between(n,15,17)+between(n,90,92)+between(n,180,182)+between(n,300,302)+between(n,345,347)'`
			tone := `aevalsrc='0.6*sin(2*PI*1000*t)*if(between(t,0.5,0.6)+between(t,3,3.1)+between(t,6,6.1)+between(t,10,10.1)+between(t,11.5,11.6),1,0)':s=48000:d=12`
			args := []string{"-v", "error", "-f", "lavfi", "-i", flash, "-f", "lavfi", "-i", tone}
			if variant == "vfr" {
				args = append(args, "-vf", `select='if(lt(t,6),not(mod(n,2)),1)'`, "-fps_mode", "vfr")
			}
			args = append(args, "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-b:a", "192k")
			if variant == "offset" {
				args = append(args, "-output_ts_offset", "3")
			}
			args = append(args, file)
			if _, e := Capture(ctx, "ffmpeg", args...); e != nil {
				t.Fatal(e)
			}
			source, e := Inspect(ctx, file, "source.mp4", false)
			if e != nil {
				t.Fatal(e)
			}
			cuts := []any{Object{"id": "a", "start": 1.2, "end": 2.4, "enabled": true}, Object{"id": "b", "start": 4.2, "end": 5.2, "enabled": true}, Object{"id": "c", "start": 8.4, "end": 9.8, "enabled": true}}
			out, e := Execute(ctx, root, Object{"type": "export", "trackIndex": float64(1), "cuts": cuts}, source, dir, nil, nil)
			if e != nil {
				t.Fatal(e)
			}
			meta, e := Capture(ctx, "ffmpeg", "-v", "error", "-i", Str(out["path"]), "-vf", "setpts=PTS-STARTPTS,signalstats,metadata=print:file=-", "-an", "-f", "null", "-")
			if e != nil {
				t.Fatal(e)
			}
			flashes := []float64{}
			at := 0.0
			active := false
			clock := regexp.MustCompile(`pts_time:([\d.]+)`)
			for _, line := range strings.Split(string(meta), "\n") {
				if m := clock.FindStringSubmatch(line); len(m) > 0 {
					at, _ = strconv.ParseFloat(m[1], 64)
				}
				if strings.HasPrefix(line, "lavfi.signalstats.YAVG=") {
					n, _ := strconv.ParseFloat(strings.TrimPrefix(line, "lavfi.signalstats.YAVG="), 64)
					white := n > 200
					if white && !active {
						flashes = append(flashes, at)
					}
					active = white
				}
			}
			raw, e := Capture(ctx, "ffmpeg", "-v", "error", "-i", Str(out["path"]), "-map", "0:a:0", "-ac", "1", "-ar", "48000", "-f", "f32le", "-")
			if e != nil {
				t.Fatal(e)
			}
			beeps := []float64{}
			active = false
			sample, last := 0, -10000
			e = PCM(bytes.NewReader(raw), 1, func(a []float32, _ []byte) error {
				for _, v := range a {
					if math.Abs(float64(v)) > .2 {
						if !active {
							beeps = append(beeps, float64(sample)/48000)
						}
						active = true
						last = sample
					} else if sample-last > 2400 {
						active = false
					}
					sample++
				}
				return nil
			})
			if e != nil {
				t.Fatal(e)
			}
			expected := []float64{.5, 1.8, 3.8, 6.4, 7.9}
			if len(flashes) != 5 || len(beeps) != 5 {
				t.Fatal(flashes, beeps)
			}
			for i, want := range expected {
				if math.Abs(beeps[i]-want) > .005 || math.Abs(flashes[i]-want) > 1.0/30+.005 || math.Abs(flashes[i]-beeps[i]) > 1.0/30+.005 {
					t.Fatalf("sync drift: flashes=%v beeps=%v", flashes, beeps)
				}
			}
			if math.Abs(Num(out["duration"])-8.4) > .04 {
				t.Fatal(out)
			}
			t.Logf("independent %s flashes=%v beeps=%v", variant, flashes, beeps)
		})
	}
}
