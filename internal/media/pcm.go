package media

import (
	"context"
	"encoding/binary"
	"fmt"
	"io"
	"math"
)

func PCM(r io.Reader, channels int, fn func([]float32, []byte) error) error {
	if channels < 1 || channels > 8 {
		return fmt.Errorf("Invalid PCM channels")
	}
	block := make([]byte, 4096*channels*4)
	for {
		n, e := io.ReadFull(r, block)
		if e != nil && e != io.EOF && e != io.ErrUnexpectedEOF {
			return e
		}
		if n%(channels*4) != 0 {
			return fmt.Errorf("오디오 샘플이 중간에 잘렸습니다.")
		}
		if n > 0 {
			s := make([]float32, n/4)
			for i := range s {
				s[i] = math.Float32frombits(binary.LittleEndian.Uint32(block[i*4:]))
				if math.IsNaN(float64(s[i])) || math.IsInf(float64(s[i]), 0) {
					return fmt.Errorf("Invalid PCM sample")
				}
			}
			if err := fn(s, block[:n]); err != nil {
				return err
			}
		}
		if e != nil {
			return nil
		}
	}
}
func SpeechSettings(v any) (Object, error) {
	if v == nil {
		return Object{"enabled": false, "threshold": .5}, nil
	}
	o := Obj(v)
	if _, ok := o["enabled"].(bool); !ok {
		return nil, fmt.Errorf("Invalid speech protection")
	}
	if !finite(o["threshold"]) || Num(o["threshold"]) < .1 || Num(o["threshold"]) > .9 {
		return nil, fmt.Errorf("Invalid speech threshold")
	}
	return Object{"enabled": o["enabled"], "threshold": o["threshold"]}, nil
}

type Progress func(Object)

func report(p Progress, stage string, n float64) {
	if p != nil {
		p(Object{"stage": stage, "progress": n})
	}
}
func Analyze(ctx context.Context, root string, m Object, settings any, index any, speech any, p Progress) (Object, error) {
	s, e := ValidateSettings(settings)
	if e != nil {
		return nil, e
	}
	protection, e := SpeechSettings(speech)
	if e != nil {
		return nil, e
	}
	track, e := Track(m, index)
	if e != nil {
		return nil, e
	}
	f, e := Frames(ctx, m)
	if e != nil {
		return nil, e
	}
	rate, channels, d := Num(track["sampleRate"]), int(Num(track["channels"])), Num(m["duration"])
	threshold := float32(math.Pow(10, Num(s["thresholdDb"])/20))
	minimum := int64(math.Ceil(Num(s["minSilenceMs"]) * rate / 1000))
	samples, quiet := int64(0), int64(-1)
	peaks := make([]float32, 1600)
	candidates := []Span{}
	endQuiet := func() {
		if quiet >= 0 && samples-quiet >= minimum {
			candidates = append(candidates, Span{float64(quiet) / rate, float64(samples) / rate})
		}
		quiet = -1
	}
	e = Stream(ctx, "ffmpeg", AudioArgs(m, track, 0, d), func(r io.Reader) error {
		return PCM(r, channels, func(a []float32, _ []byte) error {
			for i := 0; i < len(a); i += channels {
				peak := float32(0)
				for c := 0; c < channels; c++ {
					peak = max(peak, float32(math.Abs(float64(a[i+c]))))
				}
				bucket := min(1599, int(float64(samples)/rate/d*1600))
				peaks[bucket] = max(peaks[bucket], peak)
				if peak <= threshold {
					if quiet < 0 {
						quiet = samples
					}
				} else {
					endQuiet()
				}
				samples++
			}
			report(p, "음량과 무음 구간 분석", .15+.8*math.Min(1, float64(samples)/rate/d))
			return ctx.Err()
		})
	})
	if e != nil {
		return nil, e
	}
	atEnd := quiet >= 0
	endQuiet()
	if atEnd && len(candidates) > 0 && math.Abs(candidates[len(candidates)-1].End-d) <= 1/rate+1e-9 {
		candidates[len(candidates)-1].End = d
	}
	cuts := Cuts(candidates, s, d, f)
	result := Object{"settings": s, "speechProtection": protection, "trackIndex": index, "candidates": candidates, "peaks": peaks, "cuts": cuts, "decodedSamples": samples}
	if Bool(protection["enabled"]) {
		peak := float32(0)
		for _, v := range peaks {
			peak = max(peak, v)
		}
		gain := 1.0
		if peak > 0 {
			gain = math.Min(100, math.Max(1, .5/float64(peak)))
		}
		voice, err := Speech(ctx, root, m, track, Num(protection["threshold"]), gain)
		if err != nil {
			return nil, err
		}
		protected := Cuts(Protect(candidates, voice, d), s, d, f)
		result["cuts"] = protected
		result["protection"] = Object{"model": VADModel, "intervals": voice, "retainedSeconds": math.Max(0, Duration(spans(cuts, true))-Duration(spans(protected, true))), "analysisGain": gain}
	}
	return result, nil
}
