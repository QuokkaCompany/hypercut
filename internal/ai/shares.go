package ai

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"fmt"
	m "github.com/QuokkaCompany/hypercut/internal/media"
	"reflect"
	"sync"
	"time"
)

type ShareError struct {
	Status        int
	Code, Message string
}

func (e *ShareError) Error() string                 { return e.Message }
func shareError(status int, code, msg string) error { return &ShareError{status, code, msg} }

type share struct {
	id, version, task, kind, status, proposalID string
	capability, proposalHash                    [32]byte
	expires, lease                              int64
	request, proposal, resolution, schema       Object
	prompt                                      string
}
type Shares struct {
	mu     sync.Mutex
	items  map[string]*share
	closed bool
	Now    func() time.Time
}

func (s *Shares) now() int64 {
	if s.Now != nil {
		return s.Now().UnixMilli()
	}
	return time.Now().UnixMilli()
}
func (s *Shares) sweep() {
	for id, v := range s.items {
		if s.now() >= v.expires || s.now() >= v.lease {
			delete(s.items, id)
		}
	}
}
func (s *Shares) get(id string) (*share, error) {
	s.sweep()
	v := s.items[id]
	if s.closed || !RequestID.MatchString(id) || v == nil {
		return nil, shareError(404, "SHARE_UNAVAILABLE", "공유가 만료되었거나 해제되었습니다. 앱에서 다시 공유해 주세요.")
	}
	return v, nil
}
func receipt(v *share) Object {
	var proposal any
	if v.proposalID != "" {
		proposal = v.proposalID
	}
	return Object{"shareId": v.id, "contextVersion": v.version, "task": v.task, "status": v.status, "expiresAt": v.expires, "leaseExpiresAt": v.lease, "proposalId": proposal, "resolution": v.resolution}
}
func (s *Shares) Handle(method, id, action, capability string, in Object) (Object, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len([]byte(jsonString(in))) > 128*1024 {
		return nil, shareError(413, "SHARE_TOO_LARGE", "공유 요청은 128 KiB 이하여야 합니다.")
	}
	if s.closed {
		return nil, shareError(404, "SHARE_UNAVAILABLE", "앱 연결이 종료되었습니다.")
	}
	s.sweep()
	if id == "" && method == "POST" {
		if len(s.items) >= 8 {
			return nil, shareError(409, "SHARE_LIMIT", "동시 공유는 8개까지 가능합니다.")
		}
		if !exact(in, "task", "request") {
			return nil, fmt.Errorf("공유할 작업과 범위를 확인해 주세요.")
		}
		task := str(in["task"])
		kind := task
		if kind == "settings" {
			kind = "proposal"
		}
		request, e := ValidateRequest(kind, obj(in["request"]))
		if e != nil {
			return nil, e
		}
		prompt, schema, e := Prompt(kind, request)
		if e != nil {
			return nil, e
		}
		var key [32]byte
		if _, e = rand.Read(key[:]); e != nil {
			return nil, e
		}
		cap := hex.EncodeToString(key[:])
		v := &share{id: m.ID(), version: m.ID(), task: task, kind: kind, status: "waiting", capability: sha256.Sum256([]byte(cap)), expires: s.now() + 15*60*1000, lease: s.now() + 90*1000, request: request, prompt: prompt, schema: schema}
		if s.items == nil {
			s.items = map[string]*share{}
		}
		s.items[v.id] = v
		r := receipt(v)
		r["capability"] = cap
		return r, nil
	}
	if action == "owner" && method == "DELETE" {
		delete(s.items, id)
		return Object{"revoked": true}, nil
	}
	v, e := s.get(id)
	if e != nil {
		return nil, e
	}
	if action == "exchange" || action == "proposals" {
		h := sha256.Sum256([]byte(capability))
		if !regexpCapability(capability) || subtle.ConstantTimeCompare(h[:], v.capability[:]) != 1 {
			return nil, shareError(401, "SHARE_UNAUTHORIZED", "이 공유에 접근할 권한이 없습니다.")
		}
	}
	if method == "GET" {
		r := receipt(v)
		if action == "owner" {
			v.lease = min(v.expires, s.now()+90000)
			r["leaseExpiresAt"] = v.lease
			r["proposal"] = v.proposal
		} else {
			r["context"] = nil
			if v.request != nil {
				r["context"] = Object{"request": v.request, "instructions": v.prompt, "proposalSchema": v.schema}
			}
		}
		return r, nil
	}
	if action == "proposals" {
		if !exact(in, "contextVersion", "proposalId", "proposal") || in["contextVersion"] != v.version || !RequestID.MatchString(str(in["proposalId"])) || in["proposal"] == nil {
			return nil, shareError(409, "STALE_SHARE", "현재 공유의 문맥 버전과 제안 ID를 확인해 주세요.")
		}
		h := sha256.Sum256([]byte(jsonString(in["proposal"])))
		if v.proposalID != "" {
			if in["proposalId"] != v.proposalID || subtle.ConstantTimeCompare(h[:], v.proposalHash[:]) != 1 {
				return nil, shareError(409, "PROPOSAL_CONFLICT", "이미 받은 제안과 다른 요청입니다.")
			}
			return receipt(v), nil
		}
		proposal, e := ValidateProposal(v.kind, in["proposal"], v.request)
		if e != nil {
			return nil, e
		}
		v.proposal = proposal
		v.proposalID = str(in["proposalId"])
		v.proposalHash = sha256.Sum256([]byte(jsonString(proposal)))
		v.status = "proposed"
		return receipt(v), nil
	}
	if action == "resolution" {
		selected, ok := in["selectedIds"].([]any)
		if !exact(in, "contextVersion", "proposalId", "outcome", "selectedIds") || in["contextVersion"] != v.version || v.proposalID == "" || in["proposalId"] != v.proposalID || !one(str(in["outcome"]), "applied", "rejected") || !ok {
			return nil, fmt.Errorf("검토한 제안과 적용 결과를 확인해 주세요.")
		}
		resolution := Object{"outcome": in["outcome"], "selectedIds": selected}
		if v.resolution != nil {
			if !reflect.DeepEqual(resolution, v.resolution) {
				return nil, shareError(409, "PROPOSAL_CONFLICT", "이미 기록한 적용 결과는 바꿀 수 없습니다.")
			}
			return receipt(v), nil
		}
		allowed := map[string]bool{}
		if v.task == "settings" {
			allowed["settings"] = true
		} else {
			for _, x := range array(v.proposal["changes"]) {
				allowed[str(obj(x)["id"])] = true
			}
		}
		seen := map[string]bool{}
		for _, x := range selected {
			id := str(x)
			if !allowed[id] || seen[id] {
				return nil, fmt.Errorf("실제로 적용한 항목만 선택해 주세요.")
			}
			seen[id] = true
		}
		if (in["outcome"] == "applied" && len(selected) == 0) || (in["outcome"] == "rejected" && len(selected) != 0) {
			return nil, fmt.Errorf("실제로 적용한 항목만 선택해 주세요.")
		}
		v.resolution = resolution
		v.status = str(in["outcome"])
		v.request = nil
		v.prompt = ""
		v.schema = nil
		v.proposal = nil
		return receipt(v), nil
	}
	return nil, fmt.Errorf("Unknown share operation")
}
func regexpCapability(v string) bool {
	if len(v) != 64 {
		return false
	}
	_, e := hex.DecodeString(v)
	return e == nil
}
func (s *Shares) Close() { s.mu.Lock(); defer s.mu.Unlock(); s.closed = true; clear(s.items) }
