package cloud

import (
	"context"
	"fmt"
	"github.com/QuokkaCompany/hypercut/internal/media"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type WorkerOptions struct {
	Root, DataDir        string
	Quota                int64
	Poll, Lease, Timeout time.Duration
}

func (s *Store) All(ctx context.Context, kind string) ([]object, error) {
	rows, e := s.q.QueryContext(ctx, "SELECT id,owner,data,version,created FROM records WHERE kind=? ORDER BY created ASC", kind)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	r := []object{}
	for rows.Next() {
		v, e := decode(rows)
		if e != nil {
			return nil, e
		}
		r = append(r, v)
	}
	return r, rows.Err()
}
func RunWorker(ctx context.Context, o WorkerOptions) error {
	if o.Poll <= 0 {
		o.Poll = 500 * time.Millisecond
	}
	if o.Lease <= 0 {
		o.Lease = 15 * time.Second
	}
	if o.Timeout <= 0 {
		o.Timeout = 2 * time.Hour
	}
	if o.Quota <= 0 {
		o.Quota = 10 * 1024 * 1024 * 1024
	}
	store, e := OpenStore(o.DataDir)
	if e != nil {
		return e
	}
	defer store.Close()
	o.DataDir = store.Directory
	id := uuid()
	ticker := time.NewTicker(o.Poll)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
		}
		job, e := claim(ctx, store, id, o.Lease)
		if e != nil {
			if ctx.Err() != nil {
				return nil
			}
			return e
		}
		if job != nil {
			if e = work(ctx, store, o, job); e != nil {
				return e
			}
		}
	}
}

const interrupted = "Worker interrupted. Review the project and submit a new job to retry."

func claim(ctx context.Context, s *Store, id string, lease time.Duration) (object, error) {
	var result object
	expired := []string{}
	e := s.Transaction(ctx, func(tx *Store) error {
		jobs, e := tx.All(ctx, "job")
		if e != nil {
			return e
		}
		owners := map[string]bool{}
		for _, job := range jobs {
			if str(job["status"]) != "running" {
				continue
			}
			if num(job["leaseUntil"]) < now() {
				job["status"] = "failed"
				job["error"] = interrupted
				job["stage"] = "Interrupted"
				job["reservation"] = float64(0)
				job["finishedAt"] = now()
				if _, e = tx.Put(ctx, "job", job, 0); e != nil {
					return e
				}
				if requestID.MatchString(str(job["attempt"])) {
					expired = append(expired, str(job["attempt"]))
				}
			} else {
				owners[str(job["owner"])] = true
			}
		}
		for _, job := range jobs {
			if str(job["status"]) == "queued" && !owners[str(job["owner"])] {
				job["status"] = "running"
				job["workerId"] = id
				job["attempt"] = uuid()
				job["leaseUntil"] = now() + float64(lease.Milliseconds())
				job["stage"] = "Starting"
				result, e = tx.Put(ctx, "job", job, int64(num(job["reservation"])))
				return e
			}
		}
		return nil
	})
	if e == nil {
		for _, attempt := range expired {
			_ = os.RemoveAll(filepath.Join(s.Directory, "jobs", attempt))
		}
	}
	return result, e
}
func work(parent context.Context, s *Store, o WorkerOptions, job object) error {
	ctx, cancel := context.WithTimeout(parent, o.Timeout)
	defer cancel()
	dir := filepath.Join(o.DataDir, "jobs", str(job["attempt"]))
	if e := os.MkdirAll(dir, 0700); e != nil {
		return e
	}
	var mu sync.Mutex
	progress := object{}
	done := make(chan struct{})
	heartbeatCtx, stopHeartbeat := context.WithCancel(context.Background())
	go func() {
		defer close(done)
		timer := time.NewTicker(min(500*time.Millisecond, o.Lease/3))
		defer timer.Stop()
		for {
			select {
			case <-heartbeatCtx.Done():
				return
			case <-timer.C:
			}
			e := s.Transaction(heartbeatCtx, func(tx *Store) error {
				current, e := tx.Get(heartbeatCtx, "job", str(job["id"]), str(job["owner"]))
				if e != nil {
					return e
				}
				if current == nil || current["status"] != "running" || current["attempt"] != job["attempt"] || current["cancelRequested"] == true || parent.Err() != nil {
					cancel()
					return nil
				}
				mu.Lock()
				for k, v := range progress {
					current[k] = v
				}
				mu.Unlock()
				current["leaseUntil"] = now() + float64(o.Lease.Milliseconds())
				_, e = tx.Put(heartbeatCtx, "job", current, int64(num(current["reservation"])))
				return e
			})
			if e != nil {
				cancel()
				return
			}
		}
	}()
	owner := str(job["owner"])
	asset, e := s.Need(ctx, "media", str(job["mediaId"]), owner)
	registry := map[string]media.Object{}
	if e == nil {
		var effects []object
		effects, e = s.List(ctx, "effect", owner)
		for _, a := range effects {
			registry[str(a["id"])] = media.Object(a)
		}
	}
	var output media.Object
	if e == nil {
		output, e = media.Execute(ctx, o.Root, media.Object(obj(job["input"])), media.Object(asset), dir, registry, func(v media.Object) { mu.Lock(); progress = object(v); mu.Unlock() })
	}
	var size int64
	if e == nil && str(output["path"]) != "" {
		var info os.FileInfo
		info, e = os.Stat(str(output["path"]))
		if e == nil {
			size = info.Size()
		}
	}
	stopHeartbeat()
	<-done
	success := false
	failure := ""
	if e != nil {
		failure = strings.ReplaceAll(e.Error(), o.DataDir, "[storage]")
		if len(failure) > 500 {
			failure = failure[:500]
		}
	}
	finishCtx, finishCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer finishCancel()
	err := s.Transaction(finishCtx, func(tx *Store) error {
		current, e := tx.Get(finishCtx, "job", str(job["id"]), owner)
		if e != nil {
			return e
		}
		if current == nil || current["attempt"] != job["attempt"] || current["status"] != "running" {
			return nil
		}
		if failure == "" && ctx.Err() == nil && current["cancelRequested"] != true {
			usage, e := tx.Usage(finishCtx, owner)
			if e != nil {
				return e
			}
			if usage-int64(num(current["reservation"]))+size > o.Quota {
				failure = "Output exceeds the account storage quota."
			} else {
				result := object(output)
				if str(output["path"]) != "" {
					result["owner"] = owner
					result["jobId"] = job["id"]
					result["mediaId"] = job["mediaId"]
					if _, e = tx.Put(finishCtx, "export", result, size); e != nil {
						return e
					}
					safe := object{}
					for k, v := range result {
						if k != "path" {
							safe[k] = v
						}
					}
					result = safe
				}
				current["status"] = "completed"
				current["stage"] = "Completed"
				current["progress"] = float64(1)
				current["result"] = result
				success = true
			}
		}
		if !success {
			current["status"] = "failed"
			current["stage"] = "Failed"
			if current["cancelRequested"] == true {
				current["status"] = "cancelled"
				current["stage"] = "Cancelled"
			}
			if parent.Err() != nil {
				failure = interrupted
			}
			if failure == "" {
				failure = "Job interrupted or timed out."
			}
			current["error"] = failure
		}
		current["reservation"] = float64(0)
		current["finishedAt"] = now()
		_, e = tx.Put(finishCtx, "job", current, 0)
		return e
	})
	if err != nil {
		return fmt.Errorf("Commit worker result: %w", err)
	}
	if !success || str(output["path"]) == "" {
		_ = os.RemoveAll(dir)
	}
	return nil
}
