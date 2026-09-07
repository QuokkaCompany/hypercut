package cloud

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func testStore(t *testing.T) *Store {
	t.Helper()
	s, err := OpenStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}
func testUser(t *testing.T, s *Store) string {
	t.Helper()
	user, err := s.CreateUser(context.Background(), "editor@example.com", "a-long-test-password")
	if err != nil {
		t.Fatal(err)
	}
	return str(user["id"])
}
func TestReservationsAreAtomic(t *testing.T) {
	store := testStore(t)
	owner := testUser(t, store)
	ctx := context.Background()
	var accepted atomic.Int32
	var wg sync.WaitGroup
	for range 20 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			err := store.Transaction(ctx, func(tx *Store) error {
				used, err := tx.Usage(ctx, owner)
				if err != nil {
					return err
				}
				if used+80 > 100 {
					return nil
				}
				if _, err = tx.Put(ctx, "upload", object{"id": uuid(), "owner": owner}, 80); err == nil {
					accepted.Add(1)
				}
				return err
			})
			if err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	if accepted.Load() != 1 {
		t.Fatalf("accepted %d reservations", accepted.Load())
	}
	if used, _ := store.Usage(ctx, owner); used != 80 {
		t.Fatalf("usage %d", used)
	}
}
func TestSessionsAndRollback(t *testing.T) {
	store := testStore(t)
	owner := testUser(t, store)
	ctx := context.Background()
	user, err := store.Authenticate(ctx, " EDITOR@EXAMPLE.COM ", "a-long-test-password")
	if err != nil || user["id"] != owner {
		t.Fatalf("authentication: %v", err)
	}
	if _, err = store.Authenticate(ctx, "editor@example.com", "incorrect"); err == nil {
		t.Fatal("wrong password accepted")
	}
	cookie, session, err := store.NewSession(ctx, owner)
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest("GET", "http://localhost/api/config", nil)
	request.AddCookie(&http.Cookie{Name: "hypercut_session", Value: cookie})
	got, err := store.Session(ctx, request)
	if err != nil || got.CSRF != session.CSRF {
		t.Fatalf("session: %v", err)
	}
	_, err = store.q.ExecContext(ctx, "UPDATE sessions SET expires=0")
	if err != nil {
		t.Fatal(err)
	}
	if got, err = store.Session(ctx, request); err != nil || got != nil {
		t.Fatalf("expired session: %#v %v", got, err)
	}
	err = store.Transaction(ctx, func(tx *Store) error {
		_, e := tx.Put(ctx, "project", object{"id": "rollback", "owner": owner}, 50)
		if e != nil {
			return e
		}
		return fail(409, "rollback")
	})
	if err == nil {
		t.Fatal("expected rollback")
	}
	if item, _ := store.Get(ctx, "project", "rollback", owner); item != nil {
		t.Fatal("transaction committed on failure")
	}
}
func TestFutureSchemaIsRejected(t *testing.T) {
	directory := t.TempDir()
	s, err := OpenStore(directory)
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.db.Exec("PRAGMA user_version=2")
	s.Close()
	if err != nil {
		t.Fatal(err)
	}
	if next, err := OpenStore(directory); err == nil {
		next.Close()
		t.Fatal("future database schema accepted")
	}
}
func testAPI(t *testing.T) (*API, *httptest.Server, string, string) {
	t.Helper()
	server := httptest.NewUnstartedServer(nil)
	root, err := filepath.Abs("../..")
	if err != nil {
		t.Fatal(err)
	}
	dist := t.TempDir()
	if err = os.WriteFile(filepath.Join(dist, "index.html"), []byte("editor fixture"), 0600); err != nil {
		t.Fatal(err)
	}
	a, err := New(context.Background(), Options{Root: root, DataDir: t.TempDir(), DistDir: dist, PublicURL: "http://" + server.Listener.Addr().String(), Quota: 100, MaxUpload: 100})
	if err != nil {
		server.Close()
		t.Fatal(err)
	}
	server.Config.Handler = a
	server.Start()
	t.Cleanup(func() { server.Close(); a.Close() })
	owner := testUser(t, a.Store)
	cookie, session, err := a.Store.NewSession(context.Background(), owner)
	if err != nil {
		t.Fatal(err)
	}
	return a, server, cookie, session.CSRF
}
func call(t *testing.T, server *httptest.Server, method, route, cookie, token string, input io.Reader, headers map[string]string) *http.Response {
	t.Helper()
	r, err := http.NewRequest(method, server.URL+route, input)
	if err != nil {
		t.Fatal(err)
	}
	if cookie != "" {
		r.AddCookie(&http.Cookie{Name: "hypercut_session", Value: cookie})
	}
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("X-Hypercut-Token", token)
	for k, v := range headers {
		if k == "Host" {
			r.Host = v
		} else {
			r.Header.Set(k, v)
		}
	}
	response, err := server.Client().Do(r)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { response.Body.Close() })
	return response
}
func TestHTTPBoundariesAndStaticFiles(t *testing.T) {
	_, server, cookie, token := testAPI(t)
	cases := []struct {
		method, route, cookie, token, body string
		headers                            map[string]string
		status                             int
	}{
		{"GET", "/api/config", "", "", "", nil, 401},
		{"GET", "/api/runtime", "", "", "", map[string]string{"Host": "evil.invalid"}, 403},
		{"GET", "/api/config", cookie, token, "", map[string]string{"Origin": "https://evil.invalid"}, 403},
		{"GET", "/api/config", cookie, token, "", map[string]string{"Sec-Fetch-Site": "cross-site"}, 403},
		{"POST", "/api/uploads", cookie, "", "{}", nil, 403},
		{"POST", "/api/uploads", cookie, token, "null", nil, 400},
		{"POST", "/api/uploads", cookie, token, "{} {}", nil, 400},
		{"POST", "/api/uploads", cookie, token, `{"name":"large.mp4","size":101}`, nil, 413},
		{"GET", "/api/ai/claude/status", cookie, token, "", nil, 404},
		{"POST", "/api/ai/connection", cookie, token, `{"provider":"ollama","model":"local"}`, nil, 400},
	}
	for _, c := range cases {
		response := call(t, server, c.method, c.route, c.cookie, c.token, strings.NewReader(c.body), c.headers)
		if response.StatusCode != c.status {
			data, _ := io.ReadAll(response.Body)
			t.Errorf("%s %s: %d want %d: %s", c.method, c.route, response.StatusCode, c.status, data)
		}
	}
	response := call(t, server, "GET", "/", "", "", nil, nil)
	data, _ := io.ReadAll(response.Body)
	if string(data) != "editor fixture" {
		t.Fatalf("static root: %s", data)
	}
	response = call(t, server, "GET", "/api/runtime", "", "", nil, nil)
	var runtime object
	if err := json.NewDecoder(response.Body).Decode(&runtime); err != nil || runtime["apiRuntime"] != "go" {
		t.Fatalf("runtime: %#v %v", runtime, err)
	}
	response = call(t, server, "POST", "/api/uploads", cookie, token, bytes.NewBufferString(`{"name":"`+strings.Repeat("a", 10*1024*1024)+`","size":1}`), nil)
	if response.StatusCode != 413 {
		t.Fatalf("oversized JSON: %d", response.StatusCode)
	}
}
func TestMediaEngineClosureFailsClosed(t *testing.T) {
	a, server, cookie, token := testAPI(t)
	a.bridge.Close()
	<-a.bridge.done
	start := time.Now()
	for _, route := range []string{"/api/health", "/api/config"} {
		response := call(t, server, "GET", route, cookie, token, nil, nil)
		if response.StatusCode != 503 {
			t.Fatalf("%s: %d", route, response.StatusCode)
		}
	}
	if time.Since(start) > time.Second {
		t.Fatal("helper failure did not return promptly")
	}
}
