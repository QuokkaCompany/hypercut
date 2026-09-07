package ai

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type transport func(*http.Request) (*http.Response, error)

func (f transport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func reply(v any) *http.Response {
	return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(jsonString(v))), Header: http.Header{}}
}
func settings() Object {
	return Object{"thresholdDb": float64(-40), "minSilenceMs": float64(500), "preRollMs": float64(100), "postRollMs": float64(150)}
}
func request() Object {
	return Object{"instruction": "shorten pauses", "settings": settings(), "privatePath": "/private/source.mp4", "apiKey": "must-not-share"}
}
func proposal() Object { return Object{"settings": settings(), "explanation": "Keep speech intact"} }
func TestProviderWireContractsAndPrivacy(t *testing.T) {
	for _, provider := range []string{"openai", "anthropic", "ollama"} {
		t.Run(provider, func(t *testing.T) {
			client := &http.Client{Transport: transport(func(r *http.Request) (*http.Response, error) {
				b, _ := io.ReadAll(r.Body)
				if strings.Contains(string(b), "privatePath") || strings.Contains(string(b), "must-not-share") || strings.Contains(string(b), "source.mp4") {
					t.Fatal("Unselected data leaked")
				}
				var body Object
				json.Unmarshal(b, &body)
				if body["model"] != "fixture-model" {
					t.Fatal(body)
				}
				switch provider {
				case "openai":
					if r.URL.String() != "https://api.openai.com/v1/responses" || body["store"] != false || r.Header.Get("Authorization") != "Bearer fixture-key" {
						t.Fatal("OpenAI contract")
					}
					return reply(Object{"status": "completed", "output": []any{Object{"content": []any{Object{"type": "output_text", "text": jsonString(proposal())}}}}}), nil
				case "anthropic":
					if r.URL.Host != "api.anthropic.com" || r.Header.Get("x-api-key") != "fixture-key" {
						t.Fatal("Anthropic contract")
					}
					return reply(Object{"stop_reason": "end_turn", "content": []any{Object{"type": "text", "text": jsonString(proposal())}}}), nil
				default:
					if r.URL.String() != "http://127.0.0.1:11434/api/chat" || r.Header.Get("Authorization") != "" {
						t.Fatal("Ollama contract")
					}
					return reply(Object{"done": true, "message": Object{"content": jsonString(proposal())}}), nil
				}
			})}
			got, _, e := Ask(context.Background(), client, Object{"provider": provider, "model": "fixture-model", "apiKey": "fixture-key"}, "proposal", request())
			if e != nil || got["explanation"] != proposal()["explanation"] {
				t.Fatal(got, e)
			}
		})
	}
}
func TestResponseLimitsAndNoErrorEcho(t *testing.T) {
	for _, c := range []struct {
		name   string
		status int
		body   string
	}{{"provider error", 401, "fixture-secret"}, {"oversized", 200, strings.Repeat("x", 256*1024+1)}, {"invalid JSON", 200, "fixture-secret"}, {"incomplete", 200, `{"status":"incomplete"}`}} {
		t.Run(c.name, func(t *testing.T) {
			client := &http.Client{Transport: transport(func(*http.Request) (*http.Response, error) {
				return &http.Response{StatusCode: c.status, Body: io.NopCloser(strings.NewReader(c.body))}, nil
			})}
			_, _, e := Ask(context.Background(), client, Object{"provider": "openai", "model": "fixture", "apiKey": "fixture-secret"}, "proposal", request())
			if e == nil || strings.Contains(e.Error(), "fixture-secret") {
				t.Fatal(e)
			}
		})
	}
}
func TestSessionDisconnectCancellationAndDuplicate(t *testing.T) {
	started := make(chan struct{})
	session := &Session{Local: true, Client: &http.Client{Transport: transport(func(r *http.Request) (*http.Response, error) {
		close(started)
		<-r.Context().Done()
		return nil, r.Context().Err()
	})}}
	ctx := context.Background()
	c, e := session.Handle(ctx, "POST", "connection", Object{"provider": "openai", "model": "fixture", "apiKey": "fixture-secret"})
	if e != nil || strings.Contains(jsonString(c), "fixture-secret") {
		t.Fatal(c, e)
	}
	id := "00000000-0000-4000-8000-000000000001"
	in := request()
	in["requestId"] = id
	done := make(chan error, 1)
	go func() { _, e := session.Handle(ctx, "POST", "proposal", in); done <- e }()
	<-started
	if _, e = session.Handle(ctx, "POST", "proposal", in); e == nil {
		t.Fatal("concurrent request accepted")
	}
	session.Handle(ctx, "DELETE", "connection", nil)
	select {
	case e = <-done:
		if e == nil {
			t.Fatal("stale result accepted")
		}
	case <-time.After(time.Second):
		t.Fatal("not cancelled")
	}
	session.Handle(ctx, "POST", "connection", Object{"provider": "openai", "model": "fixture", "apiKey": "fixture-secret"})
	if _, e = session.Handle(ctx, "POST", "proposal", in); e == nil {
		t.Fatal("duplicate accepted")
	}
	state, _ := session.Handle(ctx, "GET", "connection", nil)
	if strings.Contains(jsonString(state), "fixture-secret") || state["verified"] != false {
		t.Fatal(state)
	}
}
func TestCaptionScopeAndNumbers(t *testing.T) {
	id := "00000000-0000-4000-8000-000000000001"
	in := Object{"requestId": id, "instruction": "correct spelling", "glossary": "", "cues": []any{Object{"id": "cue-1", "text": "3 videos"}}}
	change := Object{"id": "cue-1", "before": "3 videos", "after": "3 video clips", "reason": "grammar"}
	p := Object{"requestId": id, "changes": []any{change}}
	if _, e := ValidateProposal("correction", p, in); e != nil {
		t.Fatal(e)
	}
	change["after"] = "4 videos"
	if _, e := ValidateProposal("correction", p, in); e == nil {
		t.Fatal("number edit accepted")
	}
	change["id"] = "unselected"
	if _, e := ValidateProposal("translation", p, in); e == nil {
		t.Fatal("unselected cue accepted")
	}
	p["changes"] = []any{}
	if _, e := ValidateProposal("translation", p, in); e == nil {
		t.Fatal("partial translation accepted")
	}
}
func TestShareLeaseAndImmutableRetry(t *testing.T) {
	now := time.Unix(1000, 0)
	s := &Shares{Now: func() time.Time { return now }}
	r, e := s.Handle("POST", "", "", "", Object{"task": "settings", "request": request()})
	if e != nil {
		t.Fatal(e)
	}
	id, cap := str(r["shareId"]), str(r["capability"])
	body := Object{"contextVersion": r["contextVersion"], "proposalId": "00000000-0000-4000-8000-000000000002", "proposal": proposal()}
	if _, e = s.Handle("GET", id, "exchange", "wrong", nil); e == nil {
		t.Fatal("invalid capability accepted")
	}
	for i := 0; i < 2; i++ {
		if _, e = s.Handle("POST", id, "proposals", cap, body); e != nil {
			t.Fatal(e)
		}
	}
	obj(body["proposal"])["explanation"] = "different"
	if _, e = s.Handle("POST", id, "proposals", cap, body); e == nil {
		t.Fatal("changed retry accepted")
	}
	now = now.Add(91 * time.Second)
	if _, e = s.Handle("GET", id, "exchange", cap, nil); e == nil {
		t.Fatal("expired owner lease accepted")
	}
}
func TestCLIEnvironmentAndProcessCancellation(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "fixture-cli")
	t.Setenv("ANTHROPIC_API_KEY", "must-not-inherit")
	t.Setenv("HYPERCUT_MCP_CAPABILITY", "must-not-inherit")
	code := "#!/bin/sh\nif [ -n \"$ANTHROPIC_API_KEY$HYPERCUT_MCP_CAPABILITY\" ]; then exit 8; fi\nif [ \"$1\" = wait ]; then sleep 30; fi\nprintf '{\"ok\":true}'\n"
	if e := os.WriteFile(file, []byte(code), 0700); e != nil {
		t.Fatal(e)
	}
	v, exit, e := runCLI(context.Background(), file, nil, "", dir, time.Second)
	if e != nil || exit != 0 || str(v["stdout"]) != `{"ok":true}` {
		t.Fatal(v, exit, e)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	start := time.Now()
	_, _, e = runCLI(ctx, file, []string{"wait"}, "", dir, time.Minute)
	if e == nil || time.Since(start) > 2*time.Second {
		t.Fatal("CLI process tree not cancelled", e)
	}
}
