package media

import (
	"context"
	"fmt"
	ort "github.com/yalue/onnxruntime_go"
	"io"
	"math"
	"os"
	"path/filepath"
	"runtime"
	"sync"
)

const VADModel = "silero-vad-6.2.1"
const vadHash = "1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3"

var ortMu sync.Mutex

func initializeORT() error {
	ortMu.Lock()
	defer ortMu.Unlock()
	if ort.IsInitialized() {
		return nil
	}
	p := os.Getenv("HYPERCUT_ONNXRUNTIME_LIBRARY")
	if p == "" {
		root := os.Getenv("HYPERCUT_ROOT")
		if root == "" {
			root, _ = os.Getwd()
		}
		name := "libonnxruntime.so.1"
		if runtime.GOOS == "darwin" {
			name = "libonnxruntime.1.dylib"
		}
		p = filepath.Join(root, ".cache/native", name)
		if _, e := os.Stat(p); e != nil {
			p = filepath.Join(root, "native", name)
		}
	}
	ort.SetSharedLibraryPath(p)
	if e := ort.InitializeEnvironment(); e != nil {
		return e
	}
	return ort.DisableTelemetry()
}
func Protect(candidates, speech []Span, d float64) []Span {
	r := []Span{}
	s := Normalize(speech, d)
	for _, c := range Normalize(candidates, d) {
		cursor := c.Start
		for _, v := range s {
			if v.End <= cursor {
				continue
			}
			if v.Start >= c.End {
				break
			}
			if v.Start > cursor {
				r = append(r, Span{cursor, math.Min(v.Start, c.End)})
			}
			cursor = math.Max(cursor, v.End)
			if cursor >= c.End {
				break
			}
		}
		if cursor < c.End {
			r = append(r, Span{cursor, c.End})
		}
	}
	return r
}
func Speech(ctx context.Context, root string, m, t Object, threshold, gain float64) ([]Span, error) {
	file := filepath.Join(root, "assets/models/silero_vad.onnx")
	digest, e := Hash(ctx, file)
	if e != nil {
		return nil, e
	}
	if digest != vadHash {
		return nil, fmt.Errorf("말소리 보호 모델이 손상됐습니다.")
	}
	if e = initializeORT(); e != nil {
		return nil, e
	}
	channels := int(Num(t["channels"]))
	input, e := ort.NewEmptyTensor[float32](ort.NewShape(int64(channels), 576))
	if e != nil {
		return nil, e
	}
	defer input.Destroy()
	state, e := ort.NewEmptyTensor[float32](ort.NewShape(2, int64(channels), 128))
	if e != nil {
		return nil, e
	}
	defer state.Destroy()
	next, e := ort.NewEmptyTensor[float32](ort.NewShape(2, int64(channels), 128))
	if e != nil {
		return nil, e
	}
	defer next.Destroy()
	prob, e := ort.NewEmptyTensor[float32](ort.NewShape(int64(channels), 1))
	if e != nil {
		return nil, e
	}
	defer prob.Destroy()
	sr, e := ort.NewScalar[int64](16000)
	if e != nil {
		return nil, e
	}
	defer sr.Destroy()
	opts, e := ort.NewSessionOptions()
	if e != nil {
		return nil, e
	}
	defer opts.Destroy()
	if e = opts.SetIntraOpNumThreads(1); e != nil {
		return nil, e
	}
	if e = opts.SetInterOpNumThreads(1); e != nil {
		return nil, e
	}
	session, e := ort.NewAdvancedSession(file, []string{"input", "state", "sr"}, []string{"output", "stateN"}, []ort.Value{input, state, sr}, []ort.Value{prob, next}, opts)
	if e != nil {
		return nil, e
	}
	defer session.Destroy()
	pending := make([]float32, channels*512)
	history := make([]float32, channels*64)
	fill, position := 0, 0
	d := Num(m["duration"])
	ranges := []Span{}
	infer := func() error {
		if e := ctx.Err(); e != nil {
			return e
		}
		data := input.GetData()
		for c := 0; c < channels; c++ {
			copy(data[c*576:], history[c*64:(c+1)*64])
			for i := 0; i < 512; i++ {
				data[c*576+64+i] = float32(float64(pending[i*channels+c]) * gain)
			}
			copy(history[c*64:], data[c*576+512:(c+1)*576])
		}
		if e := session.Run(); e != nil {
			return e
		}
		copy(state.GetData(), next.GetData())
		voiced := false
		for _, p := range prob.GetData() {
			if p < 0 || p > 1 || math.IsNaN(float64(p)) {
				return fmt.Errorf("Invalid speech probability")
			}
			voiced = voiced || float64(p) >= threshold
		}
		start, end := float64(position)/16000, math.Min(d, float64(position+fill)/16000)
		if voiced {
			n := len(ranges)
			if n > 0 && start-ranges[n-1].End <= .16+1e-9 {
				ranges[n-1].End = end
			} else {
				ranges = append(ranges, Span{start, end})
			}
		}
		position += fill
		fill = 0
		clear(pending)
		return ctx.Err()
	}
	track := Copy(t)
	track["sampleRate"] = 16000
	e = Stream(ctx, "ffmpeg", AudioArgs(m, track, 0, d), func(r io.Reader) error {
		return PCM(r, channels, func(a []float32, _ []byte) error {
			for offset := 0; offset < len(a); {
				n := min(512-fill, (len(a)-offset)/channels)
				copy(pending[fill*channels:], a[offset:offset+n*channels])
				fill += n
				offset += n * channels
				if fill == 512 {
					if e := infer(); e != nil {
						return e
					}
				}
			}
			return nil
		})
	})
	if e != nil {
		return nil, e
	}
	if fill > 0 {
		if e = infer(); e != nil {
			return nil, e
		}
	}
	for i := range ranges {
		ranges[i].Start -= .032
		ranges[i].End += .032
	}
	return Normalize(ranges, d), nil
}
