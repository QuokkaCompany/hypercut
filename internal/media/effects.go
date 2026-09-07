package media

import (
	"context"
	"encoding/binary"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
)

func Mix(ctx context.Context, pcm string, clips []Object, assets []any, registry map[string]Object, track Object, work string, p Progress) (Object, error) {
	if len(clips) == 0 {
		return Object{"mixedClips": 0, "peak": nil, "peakDb": nil, "overloadedSamples": 0}, nil
	}
	type source struct {
		file   *os.File
		frames int64
	}
	sources := map[string]source{}
	defer func() {
		for _, s := range sources {
			s.file.Close()
		}
	}()
	channels, rate := int(Num(track["channels"])), Num(track["sampleRate"])
	for _, c := range clips {
		id := Str(c["assetId"])
		if _, ok := sources[id]; ok {
			continue
		}
		var expected Object
		for _, x := range assets {
			if Str(Obj(x)["id"]) == id {
				expected = Obj(x)
			}
		}
		asset := registry[id]
		if asset == nil || expected == nil || asset["fingerprint"] != expected["fingerprint"] || math.Abs(Num(asset["duration"])-Num(expected["duration"])) > .001 {
			return nil, fmt.Errorf("효과음 원본을 다시 연결해 주세요.")
		}
		hash, e := Hash(ctx, Str(asset["path"]))
		if e != nil {
			return nil, e
		}
		if hash != Str(expected["fingerprint"]) {
			return nil, fmt.Errorf("효과음 내용이 변경됐습니다.")
		}
		dest := filepath.Join(work, "fx-"+id+".f32")
		_, e = Capture(ctx, "ffmpeg", "-v", "error", "-xerror", "-nostdin", "-protocol_whitelist", "file", "-format_whitelist", "wav,mp3,mov,flac,ogg,aac", "-i", Str(asset["path"]), "-map", "0:"+number(Num(asset["trackIndex"])), "-vn", "-af", "asetpts=PTS-STARTPTS", "-ar", number(rate), "-ac", fmt.Sprint(channels), "-t", number(Num(expected["duration"])), "-c:a", "pcm_f32le", "-f", "f32le", dest)
		if e != nil {
			return nil, e
		}
		f, e := os.Open(dest)
		if e != nil {
			return nil, e
		}
		stat, e := f.Stat()
		if e != nil {
			f.Close()
			return nil, e
		}
		frames := stat.Size() / int64(4*channels)
		sources[id] = source{f, frames}
		if stat.Size()%int64(4*channels) != 0 || float64(frames) < math.Floor(Num(expected["duration"])*rate)-math.Max(2048, rate*.05) {
			return nil, fmt.Errorf("효과음 디코딩 길이가 부족합니다.")
		}
	}
	base, e := os.OpenFile(pcm, os.O_RDWR, 0600)
	if e != nil {
		return nil, e
	}
	defer base.Close()
	stat, e := base.Stat()
	if e != nil {
		return nil, e
	}
	bpf := int64(channels * 4)
	block := make([]byte, 4096*bpf)
	added := make([]byte, len(block))
	peak := 0.0
	over := 0
	for pos := int64(0); pos < stat.Size(); pos += int64(len(block)) {
		if e = ctx.Err(); e != nil {
			return nil, e
		}
		length := min(int64(len(block)), stat.Size()-pos)
		if _, e = base.ReadAt(block[:length], pos); e != nil {
			return nil, e
		}
		first, last := pos/bpf, (pos+length)/bpf
		for _, c := range clips {
			s := sources[Str(c["assetId"])]
			anchor, offset, frames := int64(math.Round(Num(c["start"])*rate)), int64(math.Round(Num(c["offset"])*rate)), int64(math.Round(Num(c["duration"])*rate))
			start, end := max(first, anchor), min(last, anchor+frames, anchor+s.frames-offset)
			if end <= start {
				continue
			}
			count := (end - start) * bpf
			if _, e = s.file.ReadAt(added[:count], (offset+start-anchor)*bpf); e != nil {
				return nil, e
			}
			gain := math.Pow(10, Num(c["gainDb"])/20)
			for i := int64(0); i < count; i += 4 {
				target := (start-first)*bpf + i
				v := float32(float64(math.Float32frombits(binary.LittleEndian.Uint32(block[target:]))) + float64(math.Float32frombits(binary.LittleEndian.Uint32(added[i:])))*gain)
				binary.LittleEndian.PutUint32(block[target:], math.Float32bits(v))
			}
		}
		for i := int64(0); i < length; i += 4 {
			v := math.Abs(float64(math.Float32frombits(binary.LittleEndian.Uint32(block[i:]))))
			if math.IsNaN(v) || math.IsInf(v, 0) {
				return nil, fmt.Errorf("Invalid effect sample")
			}
			peak = math.Max(peak, v)
			if v > 1 {
				over++
			}
		}
		if _, e = base.WriteAt(block[:length], pos); e != nil {
			return nil, e
		}
		report(p, "효과음 음량 합성", .3)
	}
	if over > 0 {
		return nil, fmt.Errorf("효과음 합성 음량이 0 dBFS를 넘었습니다. 효과음 음량을 낮춰 주세요.")
	}
	var db any
	if peak > 0 {
		db = 20 * math.Log10(peak)
	}
	return Object{"mixedClips": len(clips), "peak": peak, "peakDb": db, "overloadedSamples": over}, nil
}
func InspectMixed(ctx context.Context, file string, channels int) (Object, error) {
	peak := 0.0
	over := 0
	e := Stream(ctx, "ffmpeg", []string{"-v", "error", "-xerror", "-nostdin", "-i", file, "-map", "0:a:0", "-vn", "-c:a", "pcm_f32le", "-f", "f32le", "pipe:1"}, func(r io.Reader) error {
		return PCM(r, channels, func(s []float32, _ []byte) error {
			for _, x := range s {
				v := math.Abs(float64(x))
				peak = math.Max(peak, v)
				if v > 1 {
					over++
				}
			}
			return ctx.Err()
		})
	})
	if e != nil {
		return nil, e
	}
	if over > 0 {
		return nil, fmt.Errorf("AAC 출력 오디오가 0 dBFS를 넘었습니다.")
	}
	var db any
	if peak > 0 {
		db = 20 * math.Log10(peak)
	}
	return Object{"encodedPeak": peak, "encodedPeakDb": db, "encodedOverloadedSamples": over}, nil
}
