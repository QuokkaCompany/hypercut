package ai

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestAccentProposalContractAndProvider(t *testing.T) {
	in := Object{"requestId": "12345678-1234-4123-8123-123456789abc", "instruction": "중요한 문장만", "cues": []any{Object{"id": "a", "text": "핵심 설명", "start": 1.0, "end": 3.0}}, "filename": "private-recording.mp4"}
	change := Object{"id": "a", "reason": "핵심입니다.", "captionEnabled": true, "zoomEnabled": true, "zoomScale": 1.08}
	value := Object{"requestId": in["requestId"], "changes": []any{change}}
	if _, e := ValidateProposal("accents", value, in); e != nil {
		t.Fatal(e)
	}
	for _, patch := range []Object{{"id": "invented"}, {"start": 2.0}, {"zoomScale": 1.16}, {"captionEnabled": false, "zoomEnabled": false}} {
		c := Object{}
		for k, v := range change {
			c[k] = v
		}
		for k, v := range patch {
			c[k] = v
		}
		if _, e := ValidateProposal("accents", Object{"requestId": in["requestId"], "changes": []any{c}}, in); e == nil {
			t.Fatalf("bad proposal accepted: %v", patch)
		}
	}
	count := 0
	client := &http.Client{Transport: transport(func(r *http.Request) (*http.Response, error) {
		count++
		b, _ := io.ReadAll(r.Body)
		if r.URL.Host != "api.openai.com" || !strings.Contains(string(b), "visual_accents") || strings.Contains(string(b), "private-recording.mp4") {
			t.Fatal("invalid selected provider or unsanitized request")
		}
		return reply(Object{"status": "completed", "output": []any{Object{"content": []any{Object{"type": "output_text", "text": jsonString(value)}}}}}), nil
	})}
	s := &Session{Local: true, Client: client}
	defer s.Close()
	if _, e := s.Handle(context.Background(), "POST", "connection", Object{"provider": "openai", "model": "test-model", "apiKey": "test-key"}); e != nil {
		t.Fatal(e)
	}
	if count != 0 {
		t.Fatal("saving connection made a request")
	}
	if _, e := s.Handle(context.Background(), "POST", "accents", in); e != nil {
		t.Fatal(e)
	}
	if count != 1 {
		t.Fatal("unexpected extra provider calls")
	}
	if _, e := s.Handle(context.Background(), "POST", "accents", in); e == nil {
		t.Fatal("replayed request accepted")
	}
}
