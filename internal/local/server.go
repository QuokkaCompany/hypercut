package local

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/QuokkaCompany/hypercut/internal/ai"
	m "github.com/QuokkaCompany/hypercut/internal/media"
	"io"
	"math"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

type Object = map[string]any

var obj = m.Obj
var str = m.Str
var num = m.Num

type Options struct {
	Root, DataDir, DistDir, DesktopToken string
	Development                          bool
}
type Server struct {
	o                             Options
	Directory, Token              string
	mu                            sync.Mutex
	media, effects, exports, jobs map[string]Object
	cancelled                     []string
	cancelJobs                    map[string]context.CancelFunc
	tasks                         map[string]chan struct{}
	ctx                           context.Context
	cancel                        context.CancelFunc
	wg                            sync.WaitGroup
	closing                       bool
	ai                            *ai.Session
	shares                        ai.Shares
}

func New(parent context.Context, o Options) (*Server, error) {
	if o.Root == "" {
		o.Root, _ = os.Getwd()
	}
	if o.DataDir == "" {
		o.DataDir = filepath.Join(o.Root, ".hypercut")
	}
	if o.DistDir == "" {
		o.DistDir = filepath.Join(o.Root, "dist")
	}
	dir := filepath.Join(o.DataDir, "sessions", m.ID())
	if e := os.MkdirAll(dir, 0700); e != nil {
		return nil, e
	}
	var b [32]byte
	if _, e := rand.Read(b[:]); e != nil {
		return nil, e
	}
	ctx, cancel := context.WithCancel(parent)
	return &Server{o: o, Directory: dir, Token: hex.EncodeToString(b[:]), media: map[string]Object{}, effects: map[string]Object{}, exports: map[string]Object{}, jobs: map[string]Object{}, cancelJobs: map[string]context.CancelFunc{}, tasks: map[string]chan struct{}{}, ctx: ctx, cancel: cancel, ai: &ai.Session{Local: true}}, nil
}
func (s *Server) Close() {
	s.mu.Lock()
	s.closing = true
	s.cancel()
	s.mu.Unlock()
	s.ai.Close()
	s.shares.Close()
	s.wg.Wait()
}
func write(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	if s.closing {
		s.mu.Unlock()
		write(w, 503, Object{"error": "Server closing"})
		return
	}
	s.wg.Add(1)
	s.mu.Unlock()
	defer s.wg.Done()
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	stop := context.AfterFunc(s.ctx, cancel)
	defer stop()
	r = r.WithContext(ctx)
	host, _, e := net.SplitHostPort(r.Host)
	if e != nil {
		host = r.Host
	}
	if host != "127.0.0.1" && host != "localhost" {
		write(w, 403, Object{"error": "로컬 주소에서만 사용할 수 있습니다."})
		return
	}
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'")
	if strings.HasPrefix(r.URL.Path, "/api") {
		w.Header().Set("Cache-Control", "no-store")
		origin := r.Header.Get("Origin")
		if (origin != "" && origin != "http://"+r.Host && !(s.o.Development && origin == "http://127.0.0.1:5173")) || r.Header.Get("Sec-Fetch-Site") == "cross-site" {
			write(w, 403, Object{"error": "이 연결에서는 요청할 수 없습니다."})
			return
		}
		exchange := strings.HasPrefix(r.URL.Path, "/api/mcp-exchange/")
		desktop := r.URL.Path == "/api/desktop-control"
		if desktop {
			if s.o.DesktopToken == "" || subtle.ConstantTimeCompare([]byte(s.o.DesktopToken), []byte(r.Header.Get("X-Hypercut-Desktop-Token"))) != 1 {
				write(w, 401, Object{"error": "Desktop authorization required"})
				return
			}
		} else if r.URL.Path != "/api/config" && r.URL.Path != "/api/runtime" && !exchange {
			token := r.Header.Get("X-Hypercut-Token")
			if token == "" {
				token = r.URL.Query().Get("token")
			}
			if subtle.ConstantTimeCompare([]byte(token), []byte(s.Token)) != 1 {
				write(w, 401, Object{"error": "앱 연결이 만료되었습니다. 새로고침해 주세요."})
				return
			}
		}
		if e = s.api(w, r); e != nil {
			status := 400
			code := ""
			var se *ai.ShareError
			if errors.As(e, &se) {
				status = se.Status
				code = se.Code
			}
			v := Object{"error": e.Error()}
			if code != "" {
				v["code"] = code
			}
			write(w, status, v)
		}
		return
	}
	if r.Method != "GET" && r.Method != "HEAD" {
		http.NotFound(w, r)
		return
	}
	clean := filepath.Clean("/" + r.URL.Path)
	file := filepath.Join(s.o.DistDir, clean)
	if info, e := os.Stat(file); e != nil || info.IsDir() {
		file = filepath.Join(s.o.DistDir, "index.html")
	}
	http.ServeFile(w, r, file)
}
func input(w http.ResponseWriter, r *http.Request, limit int64) (Object, error) {
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	var in Object
	decoder := json.NewDecoder(r.Body)
	e := decoder.Decode(&in)
	if e == nil {
		var extra any
		if next := decoder.Decode(&extra); next != io.EOF {
			if next == nil {
				next = fmt.Errorf("Trailing JSON")
			}
			e = next
		}
	}
	if e == io.EOF && r.Method == "DELETE" {
		return Object{}, nil
	}
	if e != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(e, &tooLarge) {
			return nil, &ai.ShareError{Status: 413, Code: "INVALID_SHARE_BODY", Message: "Request body too large"}
		}
		return nil, fmt.Errorf("올바른 JSON 요청이 필요합니다.")
	}
	if in == nil {
		return nil, fmt.Errorf("Invalid request")
	}
	return in, nil
}
func (s *Server) register(ctx context.Context, file, name string, effect bool) (Object, error) {
	asset, e := m.Inspect(ctx, file, name, effect)
	if e != nil {
		return nil, e
	}
	if e = ctx.Err(); e != nil {
		return nil, e
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if effect {
		s.effects[str(asset["id"])] = asset
	} else {
		s.media[str(asset["id"])] = asset
	}
	return m.Public(asset), nil
}
func (s *Server) find(id string) (Object, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	v := s.media[id]
	if v == nil {
		return nil, fmt.Errorf("원본 영상을 다시 불러와 주세요.")
	}
	return m.Copy(v), nil
}
func (s *Server) api(w http.ResponseWriter, r *http.Request) error {
	p := r.URL.Path
	ctx := r.Context()
	if r.Method == "GET" && p == "/api/runtime" {
		write(w, 200, Object{"mode": "local", "apiRuntime": "go"})
		return nil
	}
	if r.Method == "GET" && p == "/api/config" {
		tools := []any{}
		for _, name := range []string{"ffmpeg", "ffprobe"} {
			b, e := m.Capture(ctx, name, "-version")
			v := Object{"name": name, "available": e == nil}
			if e == nil {
				v["version"] = strings.Split(string(b), "\n")[0]
			} else {
				v["error"] = name + " is unavailable"
			}
			tools = append(tools, v)
		}
		write(w, 200, Object{"token": s.Token, "tools": tools, "mode": "local", "maxUploadBytes": 20 * 1024 * 1024 * 1024})
		return nil
	}
	if r.Method == "GET" && p == "/api/transcription/status" {
		v, e := m.TranscriptionStatus(ctx, s.o.Root)
		if e == nil {
			write(w, 200, v)
		}
		return e
	}
	if (p == "/api/media" || p == "/api/effects") && r.Method == "POST" {
		effect := p == "/api/effects"
		limit := int64(20 * 1024 * 1024 * 1024)
		field := "video"
		if effect {
			limit = 1024 * 1024 * 1024
			field = "audio"
		}
		r.Body = http.MaxBytesReader(w, r.Body, limit+1024*1024)
		reader, e := r.MultipartReader()
		if e != nil {
			return e
		}
		file, e := os.CreateTemp(s.Directory, "upload-")
		if e != nil {
			return e
		}
		path := file.Name()
		defer file.Close()
		success := false
		defer func() {
			if !success {
				os.Remove(path)
			}
		}()
		name := ""
		fields := 0
		for {
			part, e := reader.NextPart()
			if e == io.EOF {
				break
			}
			if e != nil {
				return e
			}
			if part.FileName() == "" {
				fields++
				if effect || fields > 2 {
					return fmt.Errorf("Too many upload fields")
				}
				if _, e = io.Copy(io.Discard, io.LimitReader(part, 1024*1024+1)); e != nil {
					return e
				}
				continue
			}
			if name != "" || part.FormName() != field {
				return fmt.Errorf("Invalid upload field")
			}
			name = part.FileName()
			n, e := io.Copy(file, io.LimitReader(part, limit+1))
			if e != nil {
				return e
			}
			if n > limit {
				return fmt.Errorf("파일 크기 제한을 넘었습니다.")
			}
		}
		if name == "" {
			return fmt.Errorf("파일을 선택해 주세요.")
		}
		if e = file.Sync(); e != nil {
			return e
		}
		if e = file.Close(); e != nil {
			return e
		}
		v, e := s.register(ctx, path, name, effect)
		if e != nil {
			return e
		}
		success = true
		write(w, 200, v)
		return nil
	}
	if strings.HasPrefix(p, "/api/media/") && strings.HasSuffix(p, "/file") && r.Method == "GET" {
		id := strings.TrimSuffix(strings.TrimPrefix(p, "/api/media/"), "/file")
		asset, e := s.find(id)
		if e != nil {
			return e
		}
		var index any
		if len(m.Array(asset["audioTracks"])) > 0 {
			index = obj(m.Array(asset["audioTracks"])[0])["index"]
		}
		if value := r.URL.Query().Get("trackIndex"); value != "" {
			var n float64
			if _, e = fmt.Sscan(value, &n); e != nil {
				return e
			}
			index = n
		}
		file, e := m.Playback(ctx, asset, index, s.Directory)
		if e != nil {
			return e
		}
		w.Header().Set("Content-Type", "video/mp4")
		http.ServeFile(w, r, file)
		return nil
	}
	if strings.HasPrefix(p, "/api/exports/") && r.Method == "GET" {
		s.mu.Lock()
		out := m.Copy(s.exports[strings.TrimPrefix(p, "/api/exports/")])
		s.mu.Unlock()
		if len(out) == 0 {
			write(w, 404, Object{"error": "내보낸 파일을 찾을 수 없습니다."})
			return nil
		}
		mime := str(out["mime"])
		if mime == "" {
			mime = "video/mp4"
		}
		w.Header().Set("Content-Type", mime)
		if r.URL.Query().Get("download") != "" {
			w.Header().Set("Content-Disposition", "attachment; filename*=UTF-8''"+escapeName(str(out["name"])))
		}
		http.ServeFile(w, r, str(out["path"]))
		return nil
	}
	if strings.HasPrefix(p, "/api/jobs/") {
		return s.jobRoute(w, r)
	}
	if strings.HasPrefix(p, "/api/ai/shares") || strings.HasPrefix(p, "/api/mcp-exchange/") {
		return s.shareRoute(w, r)
	}
	if strings.HasPrefix(p, "/api/ai/") {
		in := Object{}
		var e error
		if r.Method != "GET" {
			in, e = input(w, r, 10*1024*1024)
			if e != nil {
				return e
			}
		}
		v, e := s.ai.Handle(ctx, r.Method, strings.TrimPrefix(p, "/api/ai/"), in)
		if e == nil {
			write(w, 200, v)
		}
		return e
	}
	if r.Method != "POST" {
		write(w, 404, Object{"error": "지원하지 않는 요청입니다."})
		return nil
	}
	in, e := input(w, r, 10*1024*1024)
	if e != nil && p != "/api/demo" {
		return e
	}
	switch p {
	case "/api/demo":
		file := filepath.Join(s.Directory, "demo.mp4")
		_, e := m.Capture(ctx, "ffmpeg", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=960x540:rate=30:duration=16", "-f", "lavfi", "-i", "aevalsrc='0.18*sin(2*PI*330*t)*if(between(t,1,3)+between(t,5,8)+between(t,10,12)+between(t,14,15),1,0)':s=48000:d=16", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-shortest", "-y", file)
		if e != nil {
			return e
		}
		v, e := s.register(ctx, file, "HyperCut 검증 샘플.mp4", false)
		if e == nil {
			write(w, 200, v)
		}
		return e
	case "/api/captions/style-preview":
		asset, e := s.find(str(in["mediaId"]))
		if e != nil {
			return e
		}
		if strings.TrimSpace(str(in["text"])) == "" || len([]rune(str(in["text"]))) > 2000 {
			return fmt.Errorf("미리 볼 자막 문구를 확인해 주세요.")
		}
		if in["language"] != nil && !m.Language(in["language"], false) {
			return fmt.Errorf("자막 언어가 올바르지 않습니다.")
		}
		v, e := m.RenderCaptions(ctx, s.o.Root, Object{"mode": "sample", "text": in["text"], "style": in["captionStyle"], "language": in["language"], "width": math.Ceil(num(asset["width"])/2) * 2, "height": math.Ceil(num(asset["height"])/2) * 2})
		if e == nil {
			write(w, 200, v)
		}
		return e
	case "/api/jobs":
		asset, e := s.find(str(in["mediaId"]))
		if e != nil {
			return e
		}
		if e = m.ValidateJob(in, asset); e != nil {
			return e
		}
		v, e := s.startJob(in, asset)
		if e == nil {
			write(w, 202, v)
		}
		return e
	case "/api/desktop-control":
		v, e := s.desktop(ctx, in)
		if e == nil {
			write(w, 200, v)
		}
		return e
	}
	write(w, 404, Object{"error": "지원하지 않는 요청입니다."})
	return nil
}
