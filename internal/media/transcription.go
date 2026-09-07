package media

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

const whisperName = "Whisper small (multilingual)"
const whisperHash = "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b"

func transcriptionRoot(root string) string {
	if p := os.Getenv("HYPERCUT_TRANSCRIPTION_DIR"); p != "" {
		return p
	}
	return filepath.Join(root, ".hypercut/transcription")
}
func TranscriptionStatus(ctx context.Context, root string) (Object, error) {
	dir := transcriptionRoot(root)
	bad := func(reason, msg string) (Object, error) {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return Object{"ready": false, "reason": reason, "model": whisperName, "local": true, "error": msg}, nil
	}
	cli := filepath.Join(dir, "whisper-cli")
	s, e := os.Stat(cli)
	if e != nil {
		if os.IsNotExist(e) {
			return bad("engine-missing", "로컬 전사 엔진을 찾을 수 없습니다.")
		}
		if os.IsPermission(e) {
			return bad("engine-permission", "전사 엔진을 실행할 권한이 없습니다.")
		}
		return bad("engine-unreadable", "전사 엔진을 확인하지 못했습니다.")
	}
	if !s.Mode().IsRegular() {
		return bad("engine-invalid", "전사 엔진 경로가 실행 파일이 아닙니다.")
	}
	if s.Mode().Perm()&0111 == 0 {
		return bad("engine-permission", "전사 엔진을 실행할 권한이 없습니다.")
	}
	model := filepath.Join(dir, "ggml-small.bin")
	s, e = os.Stat(model)
	if e != nil {
		if os.IsNotExist(e) {
			return bad("model-missing", "음성 인식 모델을 찾을 수 없습니다.")
		}
		if os.IsPermission(e) {
			return bad("model-permission", "음성 인식 모델을 읽을 권한이 없습니다.")
		}
		return bad("model-unreadable", "음성 인식 모델을 확인하지 못했습니다.")
	}
	if !s.Mode().IsRegular() {
		return bad("model-invalid", "음성 인식 모델 경로가 파일이 아닙니다.")
	}
	if s.Size() != 487601967 {
		return bad("model-incomplete", "음성 인식 모델의 크기가 올바르지 않습니다.")
	}
	f, e := os.Open(model)
	if e != nil {
		return bad("model-permission", "음성 인식 모델을 읽을 권한이 없습니다.")
	}
	f.Close()
	timeout, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	b, e := Capture(timeout, cli, "--version")
	if e != nil {
		if timeout.Err() != nil {
			return bad("engine-timeout", "전사 엔진 확인 시간이 초과됐습니다.")
		}
		return bad("engine-failed", "이 컴퓨터에서 전사 엔진을 실행하지 못했습니다.")
	}
	version := strings.TrimSpace(string(b))
	if !regexp.MustCompile(`^(?:whisper\.cpp version: )?1\.9\.3(?:-dev)?$`).MatchString(version) {
		return bad("engine-version", "지원하지 않는 전사 엔진 버전입니다.")
	}
	return Object{"ready": true, "model": whisperName, "engine": version, "local": true, "integrity": "checked-at-transcription"}, nil
}
func Transcribe(ctx context.Context, root string, m Object, index any, s Object, dir string, p Progress) (Object, error) {
	status, e := TranscriptionStatus(ctx, root)
	if e != nil {
		return nil, e
	}
	if !Bool(status["ready"]) {
		return nil, fmt.Errorf("%s", Str(status["error"]))
	}
	runtime := transcriptionRoot(root)
	model := filepath.Join(runtime, "ggml-small.bin")
	report(p, "로컬 전사 모델 확인", .02)
	hash, e := Hash(ctx, model)
	if e != nil {
		return nil, e
	}
	if hash != whisperHash {
		return nil, fmt.Errorf("전사 모델이 손상됐습니다. 모델을 다시 준비해 주세요.")
	}
	work, e := os.MkdirTemp(dir, "transcription-")
	if e != nil {
		return nil, e
	}
	defer os.RemoveAll(work)
	track, e := Track(m, index)
	if e != nil {
		return nil, e
	}
	track = Copy(track)
	track["sampleRate"] = 16000
	args := AudioArgs(m, track, 0, Num(m["duration"]))
	wav := filepath.Join(work, "source.wav")
	for i := 0; i < len(args)-1; i++ {
		switch args[i] {
		case "-af":
			args[i+1] += ",pan=mono|c0=c" + number(Num(s["channel"]))
		case "-ac":
			args[i+1] = "1"
		case "-c:a":
			args[i+1] = "pcm_s16le"
		case "-f":
			args[i+1] = "wav"
		}
	}
	args[len(args)-1] = wav
	report(p, "전사할 음성 준비", .05)
	if _, e = Capture(ctx, "ffmpeg", args...); e != nil {
		return nil, e
	}
	report(p, "로컬에서 음성을 글로 변환", .15)
	output := filepath.Join(work, "result")
	_, e = Capture(ctx, filepath.Join(runtime, "whisper-cli"), "-m", model, "-f", wav, "-l", Str(s["language"]), "-oj", "-of", output, "-pp", "-ng", "-t", "4", "-ml", "60", "-sow", "-sns")
	if e != nil {
		return nil, e
	}
	stat, e := os.Stat(output + ".json")
	if e != nil {
		return nil, e
	}
	if stat.Size() > 10*1024*1024 {
		return nil, fmt.Errorf("전사 결과가 너무 큽니다.")
	}
	b, e := os.ReadFile(output + ".json")
	if e != nil {
		return nil, e
	}
	var value Object
	if e = json.Unmarshal(b, &value); e != nil {
		return nil, e
	}
	segments, ok := value["transcription"].([]any)
	if !ok || len(segments) > 10000 {
		return nil, fmt.Errorf("Invalid transcription result")
	}
	cues := []any{}
	d := Num(m["duration"])
	for _, x := range segments {
		seg := Obj(x)
		off := Obj(seg["offsets"])
		if _, ok := seg["text"].(string); !ok || !finite(off["from"]) || !finite(off["to"]) || Num(off["from"]) < 0 || Num(off["to"]) < Num(off["from"]) {
			return nil, fmt.Errorf("Invalid transcription segment")
		}
		text := strings.TrimSpace(Str(seg["text"]))
		if text == "" {
			continue
		}
		start, end := Num(off["from"])/1000, Num(off["to"])/1000
		cross := end > d
		if start >= d || (cross && (end-start > 30 || start < d-30 || end > d+30)) {
			return nil, fmt.Errorf("전사 시각이 원본 길이와 일치하지 않습니다.")
		}
		c := Object{"id": ID(), "start": start, "end": min(d, end), "text": text}
		if cross {
			c["timingWarning"] = Object{"kind": "source-end", "originalEnd": end}
		}
		cues = append(cues, c)
	}
	t := Object{"trackIndex": index, "channel": s["channel"], "language": s["language"], "model": "whisper.cpp 1.9.3 / " + whisperName + " / " + whisperHash, "cues": cues}
	if Str(s["language"]) == "auto" && Language(Obj(value["result"])["language"], false) {
		t["detectedLanguage"] = Obj(value["result"])["language"]
	}
	return Transcript(t, d)
}
