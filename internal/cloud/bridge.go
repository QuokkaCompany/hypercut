package cloud

import (
	"context"
	"encoding/json"
	"github.com/QuokkaCompany/hypercut/internal/ai"
	"github.com/QuokkaCompany/hypercut/internal/media"
	"io"
	"math"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

// Bridge preserves the internal call contract while dispatching directly to Go.
// No child process, JavaScript interpreter or socket is involved.
type Bridge struct {
	root     string
	done     chan struct{}
	once     sync.Once
	mu       sync.Mutex
	sessions map[string]*ai.Session
	expires  map[string]float64
}

func StartBridge(ctx context.Context, root string) (*Bridge, error) {
	return &Bridge{root: root, done: make(chan struct{}), sessions: map[string]*ai.Session{}, expires: map[string]float64{}}, ctx.Err()
}
func (b *Bridge) Close() {
	b.once.Do(func() {
		close(b.done)
		b.mu.Lock()
		defer b.mu.Unlock()
		for _, s := range b.sessions {
			s.Close()
		}
		clear(b.sessions)
		clear(b.expires)
	})
}
func (b *Bridge) Call(ctx context.Context, body object) (any, error) {
	select {
	case <-b.done:
		return nil, fail(503, "Media engine is closed.")
	default:
	}
	data, e := json.Marshal(body)
	if e != nil {
		return nil, e
	}
	var input media.Object
	if e = json.Unmarshal(data, &input); e != nil {
		return nil, e
	}
	result, e := b.call(ctx, input)
	if e != nil {
		return nil, e
	}
	data, e = json.Marshal(result)
	if e != nil {
		return nil, e
	}
	var normalized any
	e = json.Unmarshal(data, &normalized)
	return normalized, e
}
func (b *Bridge) call(ctx context.Context, v media.Object) (any, error) {
	m := media.Obj(v["media"])
	in := media.Obj(v["input"])
	switch media.Str(v["op"]) {
	case "tools":
		r := []any{}
		for _, name := range []string{"ffmpeg", "ffprobe"} {
			out, e := media.Capture(ctx, name, "-version")
			if e != nil {
				r = append(r, object{"name": name, "available": false, "error": name + " is unavailable on the host."})
			} else {
				r = append(r, object{"name": name, "available": true, "version": strings.Split(string(out), "\n")[0]})
			}
		}
		return r, nil
	case "transcription-status":
		return media.TranscriptionStatus(ctx, b.root)
	case "validate-job":
		return object{}, media.ValidateJob(in, m)
	case "validate-project":
		effects := map[string]media.Object{}
		for _, x := range media.Array(v["effects"]) {
			a := media.Obj(x)
			effects[media.Str(a["id"])] = a
		}
		return media.Project(in, m, effects)
	case "inspect":
		file, name, kind := media.Str(in["file"]), media.Str(in["name"]), media.Str(in["kind"])
		f, e := os.Open(file)
		if e != nil {
			return nil, e
		}
		header := make([]byte, 12)
		_, e = io.ReadFull(f, header)
		f.Close()
		if e != nil {
			return nil, e
		}
		atom, magic := string(header[4:8]), string(header[:4])
		if kind == "media" {
			if !oneOf(atom, "ftyp", "moov", "mdat", "wide", "free") {
				return nil, fail(400, "Upload an MP4 or MOV file, not a playlist or URL.")
			}
		} else if kind != "effect" || !(oneOf(magic, "RIFF", "fLaC", "OggS") || oneOf(atom, "ftyp", "moov") || string(header[:3]) == "ID3" || (header[0] == 255 && header[1]&0xe0 == 0xe0)) {
			return nil, fail(400, "Upload WAV, FLAC, Ogg, MP3, AAC or M4A audio, not a playlist.")
		}
		asset, e := media.Inspect(ctx, file, name, kind == "effect")
		if e != nil {
			return nil, e
		}
		if kind == "media" {
			tracks := media.Array(asset["audioTracks"])
			valid := media.Num(asset["duration"]) <= 7200 && media.Num(asset["width"])*media.Num(asset["height"]) <= 3840*2160 && media.Num(asset["fps"]) <= 120 && len(tracks) <= 32
			for _, x := range tracks {
				valid = valid && media.Num(media.Obj(x)["channels"]) <= 8
			}
			if !valid {
				return nil, fail(400, "Cloud beta supports up to two hours, 4K, 120 fps and eight audio channels.")
			}
		}
		return object{"asset": asset, "public": media.Public(asset)}, nil
	case "playback":
		index := in["trackIndex"]
		if index == nil && len(media.Array(m["audioTracks"])) > 0 {
			index = media.Obj(media.Array(m["audioTracks"])[0])["index"]
		}
		p, e := media.Playback(ctx, m, index, media.Str(in["directory"]))
		return object{"path": p}, e
	case "forget-playback":
		return object{}, nil
	case "style-preview":
		text, language := media.Str(in["text"]), in["language"]
		if strings.TrimSpace(text) == "" || jsLength(text) > 2000 || (language != nil && !media.Language(language, false)) {
			return nil, fail(400, "Invalid caption preview.")
		}
		return media.RenderCaptions(ctx, b.root, media.Object{"mode": "sample", "text": text, "language": language, "style": in["captionStyle"], "width": math.Ceil(media.Num(m["width"])/2) * 2, "height": math.Ceil(media.Num(m["height"])/2) * 2})
	case "close-session":
		b.mu.Lock()
		defer b.mu.Unlock()
		id := media.Str(in["id"])
		if s := b.sessions[id]; s != nil {
			s.Close()
		}
		delete(b.sessions, id)
		delete(b.expires, id)
		return object{}, nil
	default:
		return nil, fail(400, "Unknown media operation.")
	}
}
func oneOf(s string, a ...string) bool {
	for _, v := range a {
		if s == v {
			return true
		}
	}
	return false
}
func (b *Bridge) AI(w http.ResponseWriter, r *http.Request, session *Session) error {
	select {
	case <-b.done:
		return fail(503, "Media engine is closed.")
	default:
	}
	kind := strings.TrimPrefix(r.URL.Path, "/api/ai/")
	if strings.HasPrefix(kind, "claude") || strings.HasPrefix(kind, "shares") {
		return fail(404, "Local AI integrations are available in the local edition.")
	}
	input := object{}
	var e error
	if r.Method != "GET" && r.Body != nil {
		input, e = body(r)
		if e != nil {
			return e
		}
	}
	b.mu.Lock()
	for id, expiry := range b.expires {
		if expiry <= now() {
			b.sessions[id].Close()
			delete(b.sessions, id)
			delete(b.expires, id)
		}
	}
	s := b.sessions[session.ID]
	if s == nil {
		if len(b.sessions) >= 100 {
			b.mu.Unlock()
			return fail(429, "AI session limit reached.")
		}
		s = &ai.Session{}
		b.sessions[session.ID] = s
		b.expires[session.ID] = float64(session.Expires)
	}
	b.mu.Unlock()
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Minute)
	defer cancel()
	result, e := s.Handle(ctx, r.Method, kind, ai.Object(input))
	if e != nil {
		return e
	}
	write(w, 200, result)
	return nil
}
