package media

import (
	"context"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"strings"
)

func editedAudio(ctx context.Context, m, t Object, kept []Span, dest string, start, end float64, p Progress) (int64, error) {
	f, e := os.OpenFile(dest, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if e != nil {
		return 0, e
	}
	defer f.Close()
	rate := Num(t["sampleRate"])
	channels := int(Num(t["channels"]))
	position := int64(math.Round(start * rate))
	written := int64(0)
	e = Stream(ctx, "ffmpeg", AudioArgs(m, t, start, end), func(r io.Reader) error {
		return PCM(r, channels, func(samples []float32, b []byte) error {
			finish := position + int64(len(samples)/channels)
			for _, s := range kept {
				a, z := max(position, int64(math.Round(s.Start*rate))), min(finish, int64(math.Round(s.End*rate)))
				if z > a {
					if _, e := f.Write(b[(a-position)*int64(channels*4) : (z-position)*int64(channels*4)]); e != nil {
						return e
					}
					written += z - a
				}
			}
			position = finish
			report(p, "오디오 컷 편집", .05+.25*math.Min(1, (float64(position)/rate-start)/(end-start)))
			return ctx.Err()
		})
	})
	return written, e
}
func Export(ctx context.Context, root string, m, in Object, dir string, registry map[string]Object, p Progress) (Object, error) {
	t, e := Track(m, in["trackIndex"])
	if e != nil {
		return nil, e
	}
	frames, e := Frames(ctx, m)
	if e != nil {
		return nil, e
	}
	d := Num(m["duration"])
	removals, kept, source, e := Plan(in["cuts"], d, frames, in["range"])
	if e != nil {
		return nil, e
	}
	expected := Duration(kept)
	if len(kept) == 0 || expected <= 0 {
		if source != nil {
			return nil, fmt.Errorf("이 범위에는 남아 있는 구간이 없습니다. 범위를 넓히거나 필요한 컷을 복원해 주세요.")
		}
		return nil, fmt.Errorf("모든 구간이 제거되었습니다. 내보내려면 일부 구간을 복원해 주세요.")
	}
	style, e := Style(in["captionStyle"])
	if e != nil {
		return nil, e
	}
	effects, e := Effects(in["effects"], d)
	if e != nil {
		return nil, e
	}
	_, full, _, e := Plan(in["cuts"], d, frames, nil)
	if e != nil {
		return nil, e
	}
	var window *Span
	if source != nil {
		start := 0.0
		for _, s := range full {
			start += math.Max(0, math.Min(s.End, source.Start)-s.Start)
		}
		window = &Span{start, start + expected}
	}
	mapped := MapEffects(effects, full, window)
	preview := Str(in["type"]) == "preview"
	subtitles := []Object{}
	tr, e := Transcript(in["transcript"], d)
	if e != nil {
		return nil, e
	}
	accents, e := VisualAccents(in["visualAccents"], d)
	if e != nil {
		return nil, e
	}
	visual, e := MapAccents(accents, tr, full, window, Bool(style["enabled"]))
	if e != nil {
		return nil, e
	}
	if len(visual) > 0 && Num(tr["trackIndex"]) != Num(in["trackIndex"]) {
		return nil, fmt.Errorf("강조 문장과 오디오 트랙이 다릅니다.")
	}
	if Bool(style["enabled"]) {
		tr, e = Transcript(in["transcript"], d)
		if e != nil {
			return nil, e
		}
		if len(Array(tr["cues"])) == 0 {
			return nil, fmt.Errorf("영상에 넣을 자막이 없습니다.")
		}
		if Num(tr["channel"]) >= Num(t["channels"]) {
			return nil, fmt.Errorf("Invalid caption channel")
		}
		if source != nil && !preview {
			reviews := map[string]string{}
			for _, c := range MapCaptions(tr, full) {
				reviews[Str(c["id"])] = Str(c["reviewKey"])
			}
			for _, c := range MapCaptions(tr, kept) {
				if !Bool(c["removed"]) && reviews[Str(c["id"])] != Str(c["reviewKey"]) {
					return nil, fmt.Errorf("클립 경계가 자막 중간을 자릅니다.")
				}
			}
		}
		subtitles, e = CaptionCues(tr, full, kept)
		if e != nil {
			return nil, e
		}
	}
	for _, c := range subtitles {
		for _, a := range visual {
			if Bool(a["captionEnabled"]) && c["cueId"] == a["cueId"] {
				c["accent"] = true
				break
			}
		}
	}
	id := ID()
	work := filepath.Join(dir, id+".work")
	if e = os.MkdirAll(work, 0700); e != nil {
		return nil, e
	}
	defer os.RemoveAll(work)
	start, end := 0.0, d
	if source != nil {
		start = math.Max(0, math.Floor(source.Start)-1)
		end = source.End
	}
	pcm := filepath.Join(work, "edited.f32")
	samples, e := editedAudio(ctx, m, t, kept, pcm, start, end, p)
	if e != nil {
		return nil, e
	}
	mix, e := Mix(ctx, pcm, mapped, Array(effects["assets"]), registry, t, work, p)
	if e != nil {
		return nil, e
	}
	var render Object
	if Bool(style["enabled"]) {
		render, e = RenderCaptions(ctx, root, Object{"mode": "sequence", "language": tr["outputLanguage"], "directory": work, "width": math.Ceil(Num(m["width"])/2) * 2, "height": math.Ceil(Num(m["height"])/2) * 2, "style": style, "cues": objects(subtitles), "duration": expected})
		if e != nil {
			return nil, e
		}
	}
	selectExpr, offset := Expressions(removals)
	scale := ",pad=ceil(iw/2)*2:ceil(ih/2)*2"
	if preview {
		scale = ",scale=w=960:h=540:force_original_aspect_ratio=decrease:force_divisible_by=2"
	}
	trim := ""
	if source != nil {
		trim = fmt.Sprintf(",trim=start=%s:end=%s", number(source.Start), number(source.End))
	}
	base := fmt.Sprintf("[0:%s]setpts=PTS-round((%s)/TB)%s,select='%s',setpts='PTS-round((%s)/TB)'", number(Num(m["videoIndex"])), number(Num(m["origin"])), trim, selectExpr, offset)
	base += AccentZoomFilter(visual, frames, kept)
	graph := base + scale + "[v]"
	if render != nil {
		graph = fmt.Sprintf("%s,scale=%s:%s,setsar=1,pad=ceil(iw/2)*2:ceil(ih/2)*2[base];[base][2:v]overlay=x=0:y=%s:eof_action=repeat:repeatlast=1:alpha=straight%s[v]", base, number(Num(m["width"])), number(Num(m["height"])), number(Num(render["offsetY"])), scale)
	}
	filter := filepath.Join(work, "filter.txt")
	if e = writeNew(filter, []byte(graph)); e != nil {
		return nil, e
	}
	output := filepath.Join(work, "output.mp4")
	args := []string{"-v", "error", "-nostdin", "-copyts"}
	args = append(args, seek(m, start)...)
	if render != nil {
		args = append(args, "-threads:v", "1")
	}
	args = append(args, "-i", Str(m["path"]), "-f", "f32le", "-ar", number(Num(t["sampleRate"])), "-ac", number(Num(t["channels"])), "-i", pcm)
	if render != nil {
		args = append(args, "-f", "concat", "-safe", "0", "-protocol_whitelist", "file,pipe", "-threads:v", "1", "-i", filepath.Join(work, "captions.ffconcat"))
	}
	preset, crf := "veryfast", "18"
	if preview {
		preset, crf = "ultrafast", "25"
	}
	args = append(args, "-filter_complex_script", filter, "-map", "[v]", "-map", "1:a:0", "-c:v", "libx264", "-threads:v", "2", "-preset", preset, "-crf", crf, "-pix_fmt", "yuv420p", "-fps_mode", "vfr", "-enc_time_base:v", "1:90000", "-video_track_timescale", "90000", "-c:a", "aac", "-b:a", "192k", "-t", fmt.Sprintf("%.9f", expected), "-movflags", "+faststart", "-y", output)
	report(p, "영상 렌더링", .45)
	if _, e = Capture(ctx, "ffmpeg", args...); e != nil {
		return nil, e
	}
	info, e := Probe(ctx, output, false)
	if e != nil {
		return nil, e
	}
	duration := parse(Obj(info["format"])["duration"])
	tolerance := math.Max(1/Num(m["fps"]), 1024/Num(t["sampleRate"])) + .005
	if math.Abs(duration-expected) > tolerance {
		return nil, fmt.Errorf("출력 길이 검증 실패 (%f / %f)", duration, expected)
	}
	video, audio := 0, 0
	for _, x := range Array(info["streams"]) {
		switch Str(Obj(x)["codec_type"]) {
		case "video":
			video++
		case "audio":
			audio++
		}
	}
	if video != 1 || audio != 1 {
		return nil, fmt.Errorf("출력 트랙 검증에 실패했습니다.")
	}
	report(p, "결과 파일 검증", .93)
	if _, e = Capture(ctx, "ffmpeg", "-v", "error", "-xerror", "-i", output, "-f", "null", "-"); e != nil {
		return nil, e
	}
	if Num(mix["mixedClips"]) > 0 {
		encoded, err := InspectMixed(ctx, output, int(Num(t["channels"])))
		if err != nil {
			return nil, err
		}
		for k, v := range encoded {
			mix[k] = v
		}
	}
	if e = ctx.Err(); e != nil {
		return nil, e
	}
	dest := filepath.Join(dir, id+".mp4")
	if e = os.Rename(output, dest); e != nil {
		return nil, e
	}
	stat, e := os.Stat(dest)
	if e != nil {
		return nil, e
	}
	suffix := "-hypercut"
	if preview {
		suffix = "-preview"
	} else if source != nil {
		suffix = "-clip"
	}
	r := Object{"id": id, "path": dest, "name": strings.TrimSuffix(Str(m["name"]), filepath.Ext(Str(m["name"]))) + suffix + ".mp4", "duration": duration, "expectedDuration": expected, "size": stat.Size(), "audioSamples": samples, "audioMix": mix, "kept": kept, "captionStyle": style, "burnedCaptions": 0, "visualAccentSegments": len(visual), "verified": true}
	if render != nil {
		r["burnedCaptions"] = render["cueCount"]
	}
	if source != nil {
		r["sourceRange"] = source
	}
	return r, nil
}
func Execute(ctx context.Context, root string, in, m Object, dir string, registry map[string]Object, p Progress) (Object, error) {
	if e := ValidateJob(in, m); e != nil {
		return nil, e
	}
	if e := os.MkdirAll(dir, 0700); e != nil {
		return nil, e
	}
	switch Str(in["type"]) {
	case "analyze":
		return Analyze(ctx, root, m, in["settings"], in["trackIndex"], in["speechProtection"], p)
	case "transcribe":
		return Transcribe(ctx, root, m, in["trackIndex"], Obj(in["transcription"]), dir, p)
	case "restore":
		f, e := Frames(ctx, m)
		if e != nil {
			return nil, e
		}
		cuts, e := Restore(in["cuts"], Obj(in["range"]), Num(m["duration"]), f)
		return Object{"cuts": cuts}, e
	case "captions", "transcript":
		t, e := Transcript(in["transcript"], Num(m["duration"]))
		if e != nil {
			return nil, e
		}
		f, e := Frames(ctx, m)
		if e != nil {
			return nil, e
		}
		_, kept, _, e := Plan(in["cuts"], Num(m["duration"]), f, nil)
		if e != nil {
			return nil, e
		}
		mode := Str(in["textMode"])
		text, e := CaptionText(t, kept, mode)
		if e != nil {
			return nil, e
		}
		ext, mime, suffix := "srt", "application/x-subrip", "edited"
		if mode != "" {
			ext, mime, suffix = "txt", "text/plain; charset=utf-8", mode
		}
		if lang := Str(t["outputLanguage"]); lang != "" {
			suffix += "-" + lang
		}
		id := ID()
		dest := filepath.Join(dir, id+"."+ext)
		if e = ctx.Err(); e != nil {
			return nil, e
		}
		if e = writeNew(dest, []byte(text)); e != nil {
			return nil, e
		}
		return Object{"id": id, "path": dest, "name": strings.TrimSuffix(Str(m["name"]), filepath.Ext(Str(m["name"]))) + "-" + suffix + "." + ext, "mime": mime, "size": len([]byte(text)), "duration": Duration(kept), "kept": kept, "verified": true}, nil
	default:
		return Export(ctx, root, m, in, dir, registry, p)
	}
}
