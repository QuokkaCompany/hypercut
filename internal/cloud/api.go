package cloud

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"math"
	"mime"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const ChunkBytes = 8 * 1024 * 1024

type Options struct {
	DataDir, DistDir, PublicURL, Root, Node string
	Quota, MaxUpload                        int64
}
type loginLimit struct {
	until            time.Time
	attempts, active int
}
type API struct {
	Store         *Store
	bridge        *Bridge
	options       Options
	origin        *url.URL
	mux           *http.ServeMux
	mu            sync.Mutex
	busy, uploads map[string]bool
	logins        map[string]*loginLimit
	authActive    int
	ctx           context.Context
	cancel        context.CancelFunc
}
type sessionKey struct{}
type handler func(http.ResponseWriter, *http.Request, *Session) error

func New(ctx context.Context, options Options) (*API, error) {
	origin, err := url.Parse(options.PublicURL)
	if err != nil {
		return nil, err
	}
	if origin.Host == "" || (origin.Path != "" && origin.Path != "/") || origin.RawQuery != "" || origin.Fragment != "" || origin.User != nil {
		return nil, fail(400, "PUBLIC_URL must be an origin.")
	}
	if origin.Scheme != "https" && !(origin.Scheme == "http" && (origin.Hostname() == "127.0.0.1" || origin.Hostname() == "localhost")) {
		return nil, fail(400, "Cloud requires HTTPS outside loopback.")
	}
	if options.Quota <= 0 || options.MaxUpload <= 0 || options.Quota > 1<<53-1 || options.MaxUpload > 1<<53-1 {
		return nil, fail(400, "Storage limits must be positive safe integers.")
	}
	if options.Node == "" {
		options.Node = "node"
	}
	options.Root, err = filepath.Abs(options.Root)
	if err != nil {
		return nil, err
	}
	if options.DistDir == "" {
		options.DistDir = filepath.Join(options.Root, "dist")
	}
	options.DistDir, err = filepath.Abs(options.DistDir)
	if err != nil {
		return nil, err
	}
	store, err := OpenStore(options.DataDir)
	if err != nil {
		return nil, err
	}
	options.DataDir = store.Directory
	life, cancel := context.WithCancel(ctx)
	bridge, err := StartBridge(life, options.Root, options.Node)
	if err != nil {
		cancel()
		store.Close()
		return nil, err
	}
	a := &API{Store: store, bridge: bridge, options: options, origin: origin, mux: http.NewServeMux(), busy: map[string]bool{}, uploads: map[string]bool{}, logins: map[string]*loginLimit{}, ctx: life, cancel: cancel}
	a.routes()
	return a, nil
}
func (a *API) Close() { a.cancel(); a.bridge.Close(); _ = a.Store.Close() }
func (a *API) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'")
	if a.origin.Scheme == "https" {
		w.Header().Set("Strict-Transport-Security", "max-age=31536000")
	}
	if r.Host != a.origin.Host {
		a.error(w, fail(403, "Unrecognized host."))
		return
	}
	if strings.HasPrefix(r.URL.Path, "/api") {
		w.Header().Set("Cache-Control", "no-store")
		if (r.Header.Get("Origin") != "" && r.Header.Get("Origin") != a.origin.Scheme+"://"+a.origin.Host) || r.Header.Get("Sec-Fetch-Site") == "cross-site" {
			a.error(w, fail(403, "Cross-origin request rejected."))
			return
		}
		if r.URL.Path != "/api/runtime" && r.URL.Path != "/api/health" && r.URL.Path != "/api/auth/login" {
			session, err := a.Store.Session(r.Context(), r)
			if err != nil {
				a.error(w, err)
				return
			}
			if session == nil {
				a.error(w, fail(401, "Sign in to continue."))
				return
			}
			if r.Method != "GET" && r.Method != "HEAD" && subtle.ConstantTimeCompare([]byte(r.Header.Get("X-Hypercut-Token")), []byte(session.CSRF)) != 1 {
				a.error(w, fail(403, "Session token mismatch. Reload the page."))
				return
			}
			r = r.WithContext(context.WithValue(r.Context(), sessionKey{}, session))
		}
		r.Body = http.MaxBytesReader(w, r.Body, 10*1024*1024)
	}
	a.mux.ServeHTTP(w, r)
}
func (a *API) error(w http.ResponseWriter, err error) {
	status := 400
	var e *HTTPError
	if errors.As(err, &e) {
		status = e.Status
	}
	var limit *http.MaxBytesError
	if errors.As(err, &limit) {
		status = 413
	}
	message := strings.ReplaceAll(err.Error(), a.Store.Directory, "[storage]")
	if len(message) > 500 {
		message = message[:500]
	}
	write(w, status, object{"error": message})
}
func write(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func body(r *http.Request) (object, error) {
	if kind, _, err := mime.ParseMediaType(r.Header.Get("Content-Type")); err != nil || kind != "application/json" {
		return nil, fail(400, "Expected application/json.")
	}
	var value object
	decoder := json.NewDecoder(r.Body)
	if err := decoder.Decode(&value); err != nil {
		var limit *http.MaxBytesError
		if errors.As(err, &limit) {
			return nil, err
		}
		return nil, fail(400, "Invalid JSON body.")
	}
	if value == nil {
		return nil, fail(400, "Expected a JSON object.")
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		return nil, fail(400, "Expected one JSON object.")
	}
	return value, nil
}
func (a *API) handle(pattern string, fn handler) {
	a.mux.HandleFunc(pattern, func(w http.ResponseWriter, r *http.Request) {
		session, _ := r.Context().Value(sessionKey{}).(*Session)
		if err := fn(w, r, session); err != nil {
			a.error(w, err)
		}
	})
}
func (a *API) limited(fn handler) handler {
	return func(w http.ResponseWriter, r *http.Request, s *Session) error {
		a.mu.Lock()
		if a.busy[s.Owner] {
			a.mu.Unlock()
			return fail(429, "Another media request is still running.")
		}
		a.busy[s.Owner] = true
		a.mu.Unlock()
		defer func() { a.mu.Lock(); delete(a.busy, s.Owner); a.mu.Unlock() }()
		return fn(w, r, s)
	}
}
func (a *API) rpc(r *http.Request, value object, timeout time.Duration) (any, error) {
	ctx, cancel := context.WithTimeout(r.Context(), timeout)
	stop := context.AfterFunc(a.ctx, cancel)
	defer stop()
	defer cancel()
	return a.bridge.Call(ctx, value)
}
func (a *API) cookie(w http.ResponseWriter, value string, age int) {
	http.SetCookie(w, &http.Cookie{Name: "hypercut_session", Value: value, Path: "/", HttpOnly: true, Secure: a.origin.Scheme == "https", SameSite: http.SameSiteStrictMode, MaxAge: age})
}
func selectFields(item object, fields ...string) object {
	result := object{}
	for _, key := range fields {
		if v, ok := item[key]; ok {
			result[key] = v
		}
	}
	return result
}
func publicProject(x object) object {
	return selectFields(x, "id", "name", "mediaId", "data", "version", "createdAt")
}
func publicJob(x object) object {
	return selectFields(x, "id", "type", "status", "progress", "stage", "error", "result", "projectId", "baseVersion", "mediaId", "createdAt", "finishedAt", "appliedVersion")
}
func publicAsset(x object) object {
	result := object{}
	for k, v := range x {
		if k != "path" && k != "owner" && k != "deleting" && k != "frames" && k != "playbacks" && k != "playbackCache" && k != "playbackPending" && k != "inputFormat" {
			result[k] = v
		}
	}
	return result
}
func active(x object) bool { return x["status"] == "queued" || x["status"] == "running" }
func integer(x any) bool {
	_, ok := x.(float64)
	n := num(x)
	return ok && n >= 0 && n <= 1<<53-1 && math.Trunc(n) == n
}

func (a *API) routes() {
	a.handle("GET /api/runtime", func(w http.ResponseWriter, _ *http.Request, _ *Session) error {
		write(w, 200, object{"mode": "cloud", "apiRuntime": "go"})
		return nil
	})
	a.handle("GET /api/health", func(w http.ResponseWriter, r *http.Request, _ *Session) error {
		if err := a.Store.db.PingContext(r.Context()); err != nil {
			return err
		}
		select {
		case <-a.bridge.done:
			return fail(503, "Media helper is unavailable.")
		default:
		}
		write(w, 200, object{"ready": true})
		return nil
	})
	a.handle("POST /api/auth/login", a.login)
	a.handle("GET /api/auth/me", func(w http.ResponseWriter, _ *http.Request, s *Session) error {
		write(w, 200, object{"user": object{"id": s.Owner, "email": s.Email}, "token": s.CSRF})
		return nil
	})
	a.handle("POST /api/auth/logout", func(w http.ResponseWriter, r *http.Request, s *Session) error {
		if _, err := a.Store.q.ExecContext(r.Context(), "DELETE FROM sessions WHERE id=?", s.ID); err != nil {
			return err
		}
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_, _ = a.bridge.Call(ctx, object{"op": "close-session", "input": object{"id": s.ID}})
		a.cookie(w, "", -1)
		write(w, 200, object{"signedOut": true})
		return nil
	})
	a.handle("GET /api/config", func(w http.ResponseWriter, r *http.Request, s *Session) error {
		tools, err := a.rpc(r, object{"op": "tools"}, 30*time.Second)
		if err != nil {
			return err
		}
		used, err := a.Store.Usage(r.Context(), s.Owner)
		if err != nil {
			return err
		}
		write(w, 200, object{"mode": "cloud", "apiRuntime": "go", "token": s.CSRF, "tools": tools, "maxUploadBytes": a.options.MaxUpload, "quotaBytes": a.options.Quota, "usedBytes": used, "aiProviders": []string{"openai", "anthropic"}})
		return nil
	})
	a.installUploads()
	a.installProjects()
	a.installJobs()
	for plural, kind := range map[string]string{"media": "media", "effects": "effect", "exports": "export"} {
		a.handle("GET /api/"+plural, func(w http.ResponseWriter, r *http.Request, s *Session) error {
			items, err := a.Store.List(r.Context(), kind, s.Owner)
			if err != nil {
				return err
			}
			result := []object{}
			for _, item := range items {
				result = append(result, publicAsset(item))
			}
			write(w, 200, result)
			return nil
		})
		a.handle("DELETE /api/"+plural+"/{id}", a.limited(func(w http.ResponseWriter, r *http.Request, s *Session) error { return a.deleteAsset(w, r, s, kind) }))
	}
	a.handle("GET /api/media/{id}", func(w http.ResponseWriter, r *http.Request, s *Session) error {
		item, err := a.Store.Need(r.Context(), "media", r.PathValue("id"), s.Owner)
		if err != nil {
			return err
		}
		write(w, 200, publicAsset(item))
		return nil
	})
	a.handle("GET /api/media/{id}/file", a.limited(func(w http.ResponseWriter, r *http.Request, s *Session) error {
		media, err := a.Store.Need(r.Context(), "media", r.PathValue("id"), s.Owner)
		if err != nil {
			return err
		}
		input := object{"directory": filepath.Join(a.Store.Directory, "playback", str(media["id"]))}
		if r.URL.Query().Has("trackIndex") {
			var n float64
			if err = json.Unmarshal([]byte(r.URL.Query().Get("trackIndex")), &n); err != nil {
				return fail(400, "Invalid audio track.")
			}
			input["trackIndex"] = n
		}
		result, err := a.rpc(r, object{"op": "playback", "media": media, "input": input}, 30*time.Minute)
		if err != nil {
			return err
		}
		return a.file(w, r, str(obj(result)["path"]), "video/mp4", "")
	}))
	a.handle("GET /api/transcription/status", func(w http.ResponseWriter, r *http.Request, _ *Session) error {
		value, err := a.rpc(r, object{"op": "transcription-status"}, 30*time.Second)
		if err != nil {
			return err
		}
		write(w, 200, value)
		return nil
	})
	a.handle("POST /api/captions/style-preview", a.limited(func(w http.ResponseWriter, r *http.Request, s *Session) error {
		input, err := body(r)
		if err != nil {
			return err
		}
		media, err := a.Store.Need(r.Context(), "media", str(input["mediaId"]), s.Owner)
		if err != nil {
			return err
		}
		result, err := a.rpc(r, object{"op": "style-preview", "media": media, "input": input}, 30*time.Second)
		if err != nil {
			return err
		}
		write(w, 200, result)
		return nil
	}))
	a.handle("GET /api/exports/{id}", func(w http.ResponseWriter, r *http.Request, s *Session) error {
		item, err := a.Store.Need(r.Context(), "export", r.PathValue("id"), s.Owner)
		if err != nil {
			return err
		}
		name := ""
		if r.URL.Query().Get("download") != "" {
			name = str(item["name"])
		}
		kind := str(item["mime"])
		if kind == "" {
			kind = "video/mp4"
		}
		return a.file(w, r, str(item["path"]), kind, name)
	})
	a.handle("/api/ai/{rest...}", func(w http.ResponseWriter, r *http.Request, s *Session) error { return a.bridge.AI(w, r, s) })
	a.handle("/api/{rest...}", func(_ http.ResponseWriter, _ *http.Request, _ *Session) error { return fail(404, "Unknown API route.") })
	a.mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" && r.Method != "HEAD" {
			http.NotFound(w, r)
			return
		}
		file := filepath.Join(a.options.DistDir, filepath.Clean("/"+r.URL.Path))
		if info, err := os.Stat(file); err != nil || info.IsDir() {
			file = filepath.Join(a.options.DistDir, "index.html")
		}
		http.ServeFile(w, r, file)
	})
}
func (a *API) login(w http.ResponseWriter, r *http.Request, _ *Session) error {
	input, err := body(r)
	if err != nil {
		return err
	}
	key, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		key = r.RemoteAddr
	}
	a.mu.Lock()
	t := time.Now()
	for id, x := range a.logins {
		if !x.until.After(t) && x.active == 0 {
			delete(a.logins, id)
		}
	}
	limit := a.logins[key]
	if limit == nil {
		limit = &loginLimit{until: t.Add(time.Minute)}
	}
	if limit.attempts >= 20 || limit.active >= 4 || a.authActive >= 4 || len(a.logins) >= 10000 {
		a.mu.Unlock()
		return fail(429, "Too many sign-in attempts. Try again in a minute.")
	}
	limit.attempts++
	limit.active++
	a.authActive++
	a.logins[key] = limit
	a.mu.Unlock()
	defer func() { a.mu.Lock(); limit.active--; a.authActive--; a.mu.Unlock() }()
	user, err := a.Store.Authenticate(r.Context(), input["email"], input["password"])
	if err != nil {
		return err
	}
	cookie, session, err := a.Store.NewSession(r.Context(), str(user["id"]))
	if err != nil {
		return err
	}
	a.cookie(w, cookie, 43200)
	write(w, 200, object{"user": user, "token": session.CSRF})
	return nil
}
func (a *API) file(w http.ResponseWriter, r *http.Request, file, kind, name string) error {
	// Only server-owned paths under the configured storage root may be streamed.
	relative, err := filepath.Rel(a.Store.Directory, file)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(os.PathSeparator)) {
		return fail(404, "File not found.")
	}
	f, err := os.Open(file)
	if err != nil {
		return fail(404, "File not found.")
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return fail(404, "File not found.")
	}
	w.Header().Set("Content-Type", kind)
	if name != "" {
		w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": name}))
	}
	http.ServeContent(w, r, name, info.ModTime(), f)
	return nil
}
