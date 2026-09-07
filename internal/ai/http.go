package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"
)

func Connection(in Object) (Object, error) {
	provider, model := str(in["provider"]), strings.TrimSpace(str(in["model"]))
	if !one(provider, "ollama", "openai", "anthropic", "claude_cli") || model == "" || length(model) > 200 || strings.ContainsAny(model, "\r\n") {
		return nil, fmt.Errorf("사용할 AI 연결과 모델 이름을 확인해 주세요.")
	}
	if provider == "claude_cli" {
		if !regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$`).MatchString(model) {
			return nil, fmt.Errorf("Claude Code 모델 이름이 올바르지 않습니다.")
		}
		return Object{"provider": provider, "model": model}, nil
	}
	if provider == "ollama" {
		address := str(in["baseURL"])
		if address == "" {
			address = "http://127.0.0.1:11434"
		}
		u, e := url.Parse(address)
		if e != nil || u.Scheme != "http" || !one(u.Hostname(), "localhost", "127.0.0.1", "::1") || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
			return nil, fmt.Errorf("Ollama는 이 컴퓨터의 HTTP 주소만 연결할 수 있습니다.")
		}
		return Object{"provider": provider, "model": model, "baseURL": "http://" + u.Host}, nil
	}
	key := str(in["apiKey"])
	if strings.TrimSpace(key) == "" || length(key) > 1000 || strings.ContainsAny(key, "\r\n") {
		return nil, fmt.Errorf("API 키를 입력해 주세요.")
	}
	return Object{"provider": provider, "model": model, "apiKey": strings.TrimSpace(key)}, nil
}
func one(s string, a ...string) bool {
	for _, x := range a {
		if s == x {
			return true
		}
	}
	return false
}
func Ask(ctx context.Context, client *http.Client, connection Object, kind string, in Object) (Object, Object, error) {
	prompt, schema, e := Prompt(kind, in)
	if e != nil {
		return nil, nil, e
	}
	config, e := Connection(connection)
	if e != nil {
		return nil, nil, e
	}
	if str(config["provider"]) == "claude_cli" {
		return AskCLI(ctx, str(config["model"]), kind, in, prompt, schema)
	}
	messages := []any{Object{"role": "user", "content": prompt}}
	headers := http.Header{"Content-Type": []string{"application/json"}}
	var address string
	var body Object
	maxTokens := 16384
	if kind == "proposal" {
		maxTokens = 2048
	}
	name := map[string]string{"proposal": "silence_settings", "correction": "caption_correction", "translation": "caption_translation", "effects": "sound_effects"}[kind]
	switch str(config["provider"]) {
	case "ollama":
		address = str(config["baseURL"]) + "/api/chat"
		options := Object{"temperature": 0}
		if kind != "proposal" {
			options["num_predict"] = maxTokens
		}
		body = Object{"model": config["model"], "messages": messages, "stream": false, "format": schema, "options": options}
	case "openai":
		address = "https://api.openai.com/v1/responses"
		headers.Set("Authorization", "Bearer "+str(config["apiKey"]))
		body = Object{"model": config["model"], "input": messages, "store": false, "max_output_tokens": maxTokens, "text": Object{"format": Object{"type": "json_schema", "name": name, "strict": true, "schema": schema}}}
	case "anthropic":
		address = "https://api.anthropic.com/v1/messages"
		headers.Set("x-api-key", str(config["apiKey"]))
		headers.Set("anthropic-version", "2023-06-01")
		if kind == "proposal" {
			maxTokens = 1024
		}
		body = Object{"model": config["model"], "messages": messages, "max_tokens": maxTokens, "output_config": Object{"format": Object{"type": "json_schema", "schema": schema}}}
	}
	if client == nil {
		client = &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return fmt.Errorf("Redirect refused") }}
	}
	timeout, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	b, _ := json.Marshal(body)
	req, e := http.NewRequestWithContext(timeout, "POST", address, bytes.NewReader(b))
	if e != nil {
		return nil, nil, e
	}
	req.Header = headers
	response, e := client.Do(req)
	if e != nil {
		if ctx.Err() != nil {
			return nil, nil, fmt.Errorf("AI 요청을 취소했습니다.")
		}
		if timeout.Err() != nil {
			return nil, nil, fmt.Errorf("AI 응답 시간이 초과됐습니다.")
		}
		return nil, nil, fmt.Errorf("AI 서버에 연결할 수 없습니다.")
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		message := map[int]string{401: "인증에 실패했습니다. API 키를 확인해 주세요.", 403: "이 모델을 사용할 권한이 없습니다.", 429: "사용량 또는 요청 한도에 도달했습니다."}[response.StatusCode]
		if message == "" {
			message = fmt.Sprintf("AI 요청이 거부되었습니다 (HTTP %d).", response.StatusCode)
		}
		return nil, nil, fmt.Errorf("%s", message)
	}
	data, e := io.ReadAll(io.LimitReader(response.Body, 256*1024+1))
	if e != nil {
		return nil, nil, fmt.Errorf("AI 응답을 읽지 못했습니다.")
	}
	if len(data) > 256*1024 {
		return nil, nil, fmt.Errorf("AI 응답 크기가 제한을 넘었습니다.")
	}
	var value Object
	if e = json.Unmarshal(data, &value); e != nil {
		return nil, nil, fmt.Errorf("AI가 올바른 JSON을 반환하지 않았습니다.")
	}
	answer := ""
	switch str(config["provider"]) {
	case "ollama":
		if value["done"] != true {
			return nil, nil, fmt.Errorf("AI 응답이 완료되지 않았습니다.")
		}
		answer = str(obj(value["message"])["content"])
	case "openai":
		if value["status"] != "completed" {
			return nil, nil, fmt.Errorf("AI 응답이 완료되지 않았습니다.")
		}
		for _, x := range array(value["output"]) {
			for _, y := range array(obj(x)["content"]) {
				c := obj(y)
				if c["type"] == "refusal" {
					return nil, nil, fmt.Errorf("AI가 제안을 거절했습니다.")
				}
				if c["type"] == "output_text" {
					answer += str(c["text"])
				}
			}
		}
	case "anthropic":
		if value["stop_reason"] != "end_turn" {
			return nil, nil, fmt.Errorf("AI 응답이 완료되지 않았습니다.")
		}
		for _, x := range array(value["content"]) {
			if obj(x)["type"] == "text" {
				answer += str(obj(x)["text"])
			}
		}
	}
	if timeout.Err() != nil {
		return nil, nil, timeout.Err()
	}
	proposal, e := ValidateProposal(kind, answer, in)
	return proposal, nil, e
}

type Session struct {
	mu         sync.Mutex
	config     Object
	active     context.CancelFunc
	activeID   string
	generation uint64
	seen       []string
	verified   bool
	execution  Object
	closed     bool
	Client     *http.Client
	Local      bool
}

func (s *Session) Close() { s.mu.Lock(); defer s.mu.Unlock(); s.closed = true; s.disconnect() }
func (s *Session) disconnect() {
	s.generation++
	if s.active != nil {
		s.active()
	}
	s.config = nil
	s.verified = false
	s.execution = nil
}
func (s *Session) remember(id string) {
	if id == "" {
		return
	}
	s.seen = append(s.seen, id)
	if len(s.seen) > 1000 {
		s.seen = s.seen[len(s.seen)-1000:]
	}
}
func (s *Session) Handle(ctx context.Context, method, kind string, in Object) (Object, error) {
	if kind == "claude/status" {
		if !s.Local {
			return nil, fmt.Errorf("Local AI integrations are available in the local edition.")
		}
		return CheckCLI(ctx)
	}
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return nil, fmt.Errorf("AI session closed")
	}
	if kind == "connection" {
		defer s.mu.Unlock()
		switch method {
		case "GET":
			if s.config == nil {
				return Object{"connected": false}, nil
			}
			r := Object{"connected": true, "provider": s.config["provider"], "model": s.config["model"], "verified": s.verified, "lastExecution": s.execution}
			if v, ok := s.config["baseURL"]; ok {
				r["baseURL"] = v
			}
			return r, nil
		case "POST":
			if !s.Local && !one(str(in["provider"]), "openai", "anthropic") {
				return nil, fmt.Errorf("Cloud supports your own OpenAI or Anthropic API key. Local providers are available in the local edition.")
			}
			c, e := Connection(in)
			if e != nil {
				return nil, e
			}
			s.disconnect()
			s.config = c
			return Object{"connected": true, "provider": c["provider"], "model": c["model"]}, nil
		case "DELETE":
			s.disconnect()
			return Object{"connected": false}, nil
		}
		return nil, fmt.Errorf("Unsupported AI method")
	}
	if !one(kind, "proposal", "correction", "translation", "effects") {
		s.mu.Unlock()
		return nil, fmt.Errorf("Unknown AI route")
	}
	id := str(in["requestId"])
	if v, ok := in["requestId"]; ok && !RequestID.MatchString(str(v)) {
		s.mu.Unlock()
		return nil, fmt.Errorf("AI 요청 ID가 올바르지 않습니다.")
	}
	if method == "DELETE" {
		s.remember(id)
		if id == "" || id == s.activeID {
			s.generation++
			if s.active != nil {
				s.active()
			}
		}
		s.mu.Unlock()
		return Object{"cancelled": true}, nil
	}
	if method != "POST" {
		s.mu.Unlock()
		return nil, fmt.Errorf("Unsupported AI method")
	}
	if s.config == nil {
		s.mu.Unlock()
		return nil, fmt.Errorf("AI를 먼저 연결해 주세요.")
	}
	if s.active != nil {
		s.mu.Unlock()
		return nil, fmt.Errorf("진행 중인 AI 요청을 취소하거나 완료한 뒤 다시 요청해 주세요.")
	}
	for _, v := range s.seen {
		if id != "" && v == id {
			s.mu.Unlock()
			return nil, fmt.Errorf("이미 처리했거나 취소한 AI 요청입니다.")
		}
	}
	s.remember(id)
	life, cancel := context.WithCancel(ctx)
	s.active = cancel
	s.activeID = id
	s.verified = false
	s.execution = nil
	revision := s.generation
	config := s.config
	s.mu.Unlock()
	defer cancel()
	proposal, execution, e := Ask(life, s.Client, config, kind, in)
	s.mu.Lock()
	defer s.mu.Unlock()
	s.active = nil
	s.activeID = ""
	if revision != s.generation {
		return nil, fmt.Errorf("연결이 변경되어 이전 AI 제안을 폐기했습니다.")
	}
	if e != nil {
		return nil, e
	}
	s.verified = true
	s.execution = execution
	return proposal, nil
}
