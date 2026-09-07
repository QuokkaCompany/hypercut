package media

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

func parse(v any) float64 {
	if finite(v) {
		return Num(v)
	}
	n, _ := strconv.ParseFloat(Str(v), 64)
	return n
}
func rational(v any) float64 {
	p := strings.FieldsFunc(Str(v), func(r rune) bool { return r == '/' || r == ':' })
	if len(p) == 0 {
		return 0
	}
	a, _ := strconv.ParseFloat(p[0], 64)
	if len(p) > 1 {
		b, _ := strconv.ParseFloat(p[1], 64)
		if b == 0 {
			return 0
		}
		a /= b
	}
	return a
}
func Hash(ctx context.Context, file string) (string, error) {
	f, e := os.Open(file)
	if e != nil {
		return "", e
	}
	defer f.Close()
	h := sha256.New()
	b := make([]byte, 128*1024)
	for {
		if e = ctx.Err(); e != nil {
			return "", e
		}
		n, err := f.Read(b)
		h.Write(b[:n])
		if err == io.EOF {
			break
		}
		if err != nil {
			return "", err
		}
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}
func Probe(ctx context.Context, file string, effect bool) (Object, error) {
	args := []string{"-v", "error", "-protocol_whitelist", "file"}
	if effect {
		args = append(args, "-format_whitelist", "wav,mp3,mov,flac,ogg,aac")
	} else {
		args = append(args, "-f", "mov")
	}
	args = append(args, "-show_format", "-show_streams", "-of", "json", file)
	b, e := Capture(ctx, "ffprobe", args...)
	if e != nil {
		return nil, e
	}
	var o Object
	e = json.Unmarshal(b, &o)
	return o, e
}
func Inspect(ctx context.Context, file, name string, effect bool) (Object, error) {
	info, e := Probe(ctx, file, effect)
	if e != nil {
		return nil, e
	}
	stat, e := os.Stat(file)
	if e != nil {
		return nil, e
	}
	var video Object
	tracks := []any{}
	for _, v := range Array(info["streams"]) {
		s := Obj(v)
		if Str(s["codec_type"]) == "video" && !Bool(Obj(s["disposition"])["attached_pic"]) && Num(Obj(s["disposition"])["attached_pic"]) == 0 {
			video = s
		}
		if Str(s["codec_type"]) == "audio" {
			tags := Obj(s["tags"])
			label := Str(tags["title"])
			if label == "" {
				label = Str(tags["handler_name"])
			}
			if label == "" {
				label = fmt.Sprintf("오디오 %v", s["index"])
			}
			tracks = append(tracks, Object{"index": s["index"], "codec": s["codec_name"], "channels": s["channels"], "sampleRate": parse(s["sample_rate"]), "label": label, "language": Str(tags["language"]), "duration": parse(s["duration"])})
		}
	}
	if name == "" {
		name = file
	}
	digest, e := Hash(ctx, file)
	if e != nil {
		return nil, e
	}
	formatDuration := parse(Obj(info["format"])["duration"])
	if effect {
		if len(tracks) != 1 || video != nil || stat.Size() > 1024*1024*1024 {
			return nil, fmt.Errorf("Select a single-track audio effect under 1 GB")
		}
		track := Obj(tracks[0])
		d := Num(track["duration"])
		if d == 0 {
			d = formatDuration
		}
		if d < .01 || d > 300 || (Num(track["channels"]) != 1 && Num(track["channels"]) != 2) {
			return nil, fmt.Errorf("Effect must be mono/stereo and 0.01–300 seconds")
		}
		return Object{"id": digest, "fingerprint": digest, "name": filepath.Base(name), "duration": d, "path": file, "trackIndex": track["index"]}, nil
	}
	if video == nil {
		return nil, fmt.Errorf("영상 트랙이 없는 파일입니다. MP4 또는 MOV 영상을 선택해 주세요.")
	}
	if Str(video["codec_name"]) != "h264" {
		return nil, fmt.Errorf("현재는 H.264 영상을 지원합니다.")
	}
	if t := Str(video["color_transfer"]); t == "smpte2084" || t == "arib-std-b67" {
		return nil, fmt.Errorf("HDR 영상은 아직 지원하지 않습니다.")
	}
	d := parse(video["duration"])
	if d == 0 {
		d = formatDuration
	}
	if d <= 0 || math.IsInf(d, 0) || math.IsNaN(d) {
		return nil, fmt.Errorf("Invalid video duration")
	}
	tb := rational(video["time_base"])
	origin := parse(video["start_time"])
	if v, ok := video["start_pts"]; ok {
		origin = parse(v) * tb
	}
	rot := parse(Obj(video["tags"])["rotate"])
	for _, x := range Array(video["side_data_list"]) {
		if v, ok := Obj(x)["rotation"]; ok {
			rot = parse(v)
			break
		}
	}
	sar := rational(video["sample_aspect_ratio"])
	if sar == 0 {
		sar = 1
	}
	w, h := Num(video["width"])*sar, Num(video["height"])
	if math.Abs(math.Mod(math.Abs(rot), 180)-90) < .001 {
		w, h = h, w
	}
	fps := rational(video["avg_frame_rate"])
	if fps == 0 {
		fps = 30
	}
	for _, x := range tracks {
		delete(Obj(x), "duration")
	}
	return Object{"id": ID(), "path": file, "name": filepath.Base(name), "duration": d, "fingerprint": digest, "width": math.Round(w), "height": math.Round(h), "fps": fps, "size": stat.Size(), "videoIndex": video["index"], "timeBase": tb, "origin": origin, "audioTracks": tracks}, nil
}
func Public(o Object) Object {
	r := Copy(o)
	for _, k := range []string{"path", "frames", "playbacks", "owner"} {
		delete(r, k)
	}
	return r
}
func Track(m Object, index any) (Object, error) {
	for _, x := range Array(m["audioTracks"]) {
		o := Obj(x)
		if Num(o["index"]) == Num(index) && integer(index) {
			if Num(o["channels"]) > 0 && Num(o["channels"]) <= 8 && Num(o["sampleRate"]) > 0 {
				return o, nil
			}
		}
	}
	return nil, fmt.Errorf("분석할 오디오 트랙을 선택해 주세요.")
}
func Frames(ctx context.Context, m Object) ([]float64, error) {
	d := Num(m["duration"])
	f := []float64{0, d}
	e := Stream(ctx, "ffprobe", []string{"-v", "error", "-select_streams", number(Num(m["videoIndex"])), "-show_entries", "frame=best_effort_timestamp", "-of", "csv=p=0", Str(m["path"])}, func(r io.Reader) error {
		s := bufio.NewScanner(r)
		for s.Scan() {
			line := strings.Split(s.Text(), ",")[0]
			v, err := strconv.ParseFloat(line, 64)
			t := v*Num(m["timeBase"]) - Num(m["origin"])
			if err == nil && t >= 0 && t < d {
				f = append(f, t)
			}
		}
		return s.Err()
	})
	sort.Float64s(f)
	out := f[:0]
	for _, x := range f {
		if len(out) == 0 || x != out[len(out)-1] {
			out = append(out, x)
		}
	}
	return out, e
}
func seek(m Object, start float64) []string {
	if start <= 0 {
		return nil
	}
	return []string{"-noaccurate_seek", "-seek_timestamp", "1", "-ss", fmt.Sprintf("%.9f", Num(m["origin"])+start)}
}
func AudioArgs(m, t Object, start, end float64) []string {
	a := []string{"-v", "error", "-nostdin", "-copyts"}
	a = append(a, seek(m, start)...)
	return append(a, "-i", Str(m["path"]), "-map", "0:"+number(Num(t["index"])), "-vn", "-af", fmt.Sprintf("asetpts=PTS-(%s)/TB,aresample=async=1:first_pts=%s,apad,atrim=end=%s", number(Num(m["origin"])), number(math.Round(start*Num(t["sampleRate"]))), number(end)), "-ar", number(Num(t["sampleRate"])), "-ac", number(Num(t["channels"])), "-c:a", "pcm_f32le", "-f", "f32le", "pipe:1")
}
func Playback(ctx context.Context, m Object, index any, dir string) (string, error) {
	tracks := Array(m["audioTracks"])
	if math.Abs(Num(m["origin"])) < 1e-7 && (len(tracks) == 0 || Num(Obj(tracks[0])["index"]) == Num(index)) {
		return Str(m["path"]), nil
	}
	t, e := Track(m, index)
	if e != nil {
		return "", e
	}
	if e = os.MkdirAll(dir, 0700); e != nil {
		return "", e
	}
	dest := filepath.Join(dir, ID()+"-playback.mp4")
	_, e = Capture(ctx, "ffmpeg", "-v", "error", "-nostdin", "-copyts", "-itsoffset", number(-Num(m["origin"])), "-i", Str(m["path"]), "-map", "0:"+number(Num(m["videoIndex"])), "-map", "0:"+number(Num(t["index"])), "-c:v", "copy", "-af", "aresample=async=1:first_pts=0,apad,atrim=end="+number(Num(m["duration"])), "-c:a", "aac", "-b:a", "192k", "-t", number(Num(m["duration"])), "-movflags", "+faststart", "-y", dest)
	if e != nil {
		os.Remove(dest)
	}
	return dest, e
}
