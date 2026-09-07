package local

import (
	"context"
	"errors"
	"io"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDesktopAuthorityAndOriginalProtection(t *testing.T) {
	dir := t.TempDir()
	s, e := New(context.Background(), Options{DataDir: dir, DesktopToken: "desktop-only"})
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	r := httptest.NewRequest("POST", "http://127.0.0.1/api/desktop-control", strings.NewReader(`{"op":"registerFile","path":"/private/source.mp4"}`))
	r.Header.Set("X-Hypercut-Token", s.Token)
	w := httptest.NewRecorder()
	s.ServeHTTP(w, r)
	if w.Code != 401 {
		t.Fatal("editor token received filesystem authority", w.Code)
	}
	source := filepath.Join(dir, "source.mp4")
	os.WriteFile(source, []byte("original"), 0600)
	alias := filepath.Join(dir, "hardlink.mp4")
	if e = os.Link(source, alias); e != nil {
		t.Fatal(e)
	}
	s.media["one"] = Object{"path": source}
	for _, p := range []string{source, alias} {
		if e = s.protect(p); e == nil {
			t.Fatal("original alias overwrite permitted")
		}
	}
	if e = s.protect(filepath.Join(dir, "new.mp4")); e != nil {
		t.Fatal(e)
	}
}
func TestAtomicSavePreservesExistingOnFailure(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "saved.mp4")
	os.WriteFile(target, []byte("existing"), 0600)
	e := atomicWrite(target, func(f *os.File) error { f.Write([]byte("partial")); return errors.New("disk fixture") })
	if e == nil {
		t.Fatal("failure swallowed")
	}
	b, _ := os.ReadFile(target)
	if string(b) != "existing" {
		t.Fatal("existing save lost")
	}
	entries, _ := os.ReadDir(dir)
	if len(entries) != 1 {
		t.Fatal("temporary save leaked")
	}
	if e = atomicWrite(target, func(f *os.File) error { _, e := io.WriteString(f, "complete"); return e }); e != nil {
		t.Fatal(e)
	}
	b, _ = os.ReadFile(target)
	if string(b) != "complete" {
		t.Fatal("new save missing")
	}
}
func TestMalformedAndOversizeJSON(t *testing.T) {
	for _, body := range []string{`{} {}`, `{"x":"` + strings.Repeat("x", 2048) + `"}`, `null`} {
		r := httptest.NewRequest("POST", "http://127.0.0.1/api", strings.NewReader(body))
		if _, e := input(httptest.NewRecorder(), r, 1024); e == nil {
			t.Fatal("invalid input accepted")
		}
	}
}
