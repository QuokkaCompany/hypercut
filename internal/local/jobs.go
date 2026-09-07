package local

import (
	"context"
	"fmt"
	"github.com/QuokkaCompany/hypercut/internal/ai"
	m "github.com/QuokkaCompany/hypercut/internal/media"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

func escapeName(s string) string { return strings.ReplaceAll(url.QueryEscape(s), "+", "%20") }
func (s *Server) startJob(in, asset Object) (Object, error) {
	id := str(in["requestId"])
	if id == "" {
		if _, ok := in["requestId"]; ok {
			return nil, fmt.Errorf("작업 ID가 올바르지 않습니다.")
		}
		id = m.ID()
	}
	if !ai.RequestID.MatchString(id) {
		return nil, fmt.Errorf("작업 ID가 올바르지 않습니다.")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closing {
		return nil, fmt.Errorf("Server closing")
	}
	if len(s.jobs) > 100 {
		for key, j := range s.jobs {
			if j["status"] != "running" {
				delete(s.jobs, key)
				delete(s.tasks, key)
			}
			if len(s.jobs) <= 50 {
				break
			}
		}
	}
	if s.jobs[id] != nil {
		return nil, fmt.Errorf("이미 처리한 작업 ID입니다.")
	}
	for _, cancelled := range s.cancelled {
		if cancelled == id {
			j := Object{"id": id, "type": in["type"], "mediaId": asset["id"], "status": "cancelled", "progress": 0, "stage": "취소됨", "createdAt": time.Now().UnixMilli(), "finishedAt": time.Now().UnixMilli()}
			s.jobs[id] = j
			return Object{"id": id, "type": in["type"], "status": "cancelled"}, nil
		}
	}
	for _, j := range s.jobs {
		if j["status"] == "running" {
			return nil, fmt.Errorf("진행 중인 작업을 완료하거나 취소한 뒤 다시 실행해 주세요.")
		}
	}
	ctx, cancel := context.WithCancel(s.ctx)
	j := Object{"id": id, "type": in["type"], "mediaId": asset["id"], "status": "running", "progress": 0, "stage": "작업 준비", "createdAt": time.Now().UnixMilli()}
	s.jobs[id] = j
	s.cancelJobs[id] = cancel
	done := make(chan struct{})
	s.tasks[id] = done
	registry := map[string]Object{}
	for key, v := range s.effects {
		registry[key] = m.Copy(v)
	}
	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		defer close(done)
		defer cancel()
		result, e := m.Execute(ctx, s.o.Root, in, asset, s.Directory, registry, func(v Object) {
			s.mu.Lock()
			defer s.mu.Unlock()
			if j["status"] == "running" {
				for k, x := range v {
					j[k] = x
				}
			}
		})
		s.mu.Lock()
		defer s.mu.Unlock()
		delete(s.cancelJobs, id)
		if ctx.Err() != nil {
			j["status"] = "cancelled"
			if result != nil && str(result["path"]) != "" {
				os.Remove(str(result["path"]))
			}
		} else if e != nil {
			j["status"] = "failed"
			j["error"] = e.Error()
		} else {
			if str(result["path"]) != "" {
				s.exports[str(result["id"])] = result
				result = m.Copy(result)
				delete(result, "path")
			}
			j["result"] = result
			j["status"] = "completed"
			j["progress"] = 1
			j["stage"] = "완료"
		}
		j["finishedAt"] = time.Now().UnixMilli()
	}()
	return Object{"id": id, "type": in["type"], "status": "running"}, nil
}
func (s *Server) jobRoute(w http.ResponseWriter, r *http.Request) error {
	id := strings.TrimPrefix(r.URL.Path, "/api/jobs/")
	s.mu.Lock()
	job := s.jobs[id]
	if r.Method == "GET" {
		if job == nil {
			s.mu.Unlock()
			write(w, 404, Object{"error": "작업을 찾을 수 없습니다."})
			return nil
		}
		copy := m.Copy(job)
		s.mu.Unlock()
		write(w, 200, copy)
		return nil
	}
	if r.Method != "DELETE" {
		s.mu.Unlock()
		write(w, 404, Object{"error": "Unknown job route"})
		return nil
	}
	if job == nil && ai.RequestID.MatchString(id) {
		s.cancelled = append(s.cancelled, id)
		if len(s.cancelled) > 256 {
			s.cancelled = s.cancelled[len(s.cancelled)-256:]
		}
	}
	var done chan struct{}
	if cancel := s.cancelJobs[id]; cancel != nil {
		job["stage"] = "취소 중"
		cancel()
		done = s.tasks[id]
	}
	s.mu.Unlock()
	if done != nil {
		select {
		case <-done:
		case <-r.Context().Done():
			return r.Context().Err()
		}
	}
	s.mu.Lock()
	cancelled := job != nil && job["status"] == "cancelled"
	for _, v := range s.cancelled {
		cancelled = cancelled || v == id
	}
	s.mu.Unlock()
	write(w, 200, Object{"cancelled": cancelled})
	return nil
}
