package cloud

import (
	"bytes"
	"encoding/json"
	"math"
	"net/http"
	"time"
)

func (a *API) installJobs() {
	a.handle("GET /api/jobs", func(w http.ResponseWriter, r *http.Request, s *Session) error {
		items, err := a.Store.List(r.Context(), "job", s.Owner)
		if err != nil {
			return err
		}
		result := []object{}
		for _, job := range items {
			result = append(result, publicJob(job))
		}
		write(w, 200, result)
		return nil
	})
	a.handle("GET /api/jobs/{id}", func(w http.ResponseWriter, r *http.Request, s *Session) error {
		job, err := a.Store.Need(r.Context(), "job", r.PathValue("id"), s.Owner)
		if err != nil {
			return err
		}
		write(w, 200, publicJob(job))
		return nil
	})
	a.handle("POST /api/jobs", func(w http.ResponseWriter, r *http.Request, s *Session) error {
		input, err := body(r)
		if err != nil {
			return err
		}
		id := str(input["requestId"])
		if input["requestId"] == nil {
			id = uuid()
		}
		if !requestID.MatchString(id) {
			return fail(400, "Invalid job ID.")
		}
		var job object
		err = a.Store.Transaction(r.Context(), func(tx *Store) error {
			old, e := tx.Get(r.Context(), "job", id, s.Owner)
			if e != nil {
				return e
			}
			if old != nil {
				left, _ := json.Marshal(old["input"])
				right, _ := json.Marshal(input)
				if !bytes.Equal(left, right) {
					return fail(409, "Job ID was already used for different input.")
				}
				job = old
				return nil
			}
			exists, e := tx.Exists(r.Context(), "job", id)
			if e != nil {
				return e
			}
			if exists {
				return fail(409, "Job ID is unavailable.")
			}
			media, e := tx.Need(r.Context(), "media", str(input["mediaId"]), s.Owner)
			if e != nil {
				return e
			}
			if _, e = a.rpc(r, object{"op": "validate-job", "input": input, "media": media}, 30*time.Second); e != nil {
				return e
			}
			for _, asset := range array(obj(input["effects"])["assets"]) {
				if _, e = tx.Need(r.Context(), "effect", str(obj(asset)["id"]), s.Owner); e != nil {
					return e
				}
			}
			job = object{"id": id, "owner": s.Owner, "input": input, "type": input["type"], "mediaId": media["id"], "progress": float64(0), "status": "queued", "stage": "Queued"}
			if input["projectId"] != nil {
				project, e := tx.Need(r.Context(), "project", str(input["projectId"]), s.Owner)
				if e != nil {
					return e
				}
				if project["mediaId"] != media["id"] || project["version"] != input["baseVersion"] {
					return fail(409, "Project changed. Save and retry.")
				}
				job["projectId"] = project["id"]
				job["baseVersion"] = project["version"]
			}
			items, e := tx.List(r.Context(), "job", s.Owner)
			if e != nil {
				return e
			}
			count := 0
			for _, item := range items {
				if active(item) {
					count++
				}
			}
			if count >= 4 {
				return fail(429, "Finish or cancel existing jobs first.")
			}
			if len(items) >= 500 {
				return fail(429, "Remove old jobs before adding more.")
			}
			reservation := int64(0)
			switch input["type"] {
			case "export", "preview", "captions", "transcript":
				reservation = int64(math.Max(32*1024*1024, num(media["size"])*3))
			}
			usage, e := tx.Usage(r.Context(), s.Owner)
			if e != nil {
				return e
			}
			if usage+reservation > a.options.Quota {
				return fail(413, "Insufficient storage quota for this output.")
			}
			cancelled, e := tx.Get(r.Context(), "cancel", id, s.Owner)
			if e != nil {
				return e
			}
			if cancelled != nil {
				job["status"] = "cancelled"
				job["stage"] = "Cancelled"
				reservation = 0
			}
			job["reservation"] = number(reservation)
			job, e = tx.Put(r.Context(), "job", job, reservation)
			return e
		})
		if err != nil {
			return err
		}
		write(w, 202, publicJob(job))
		return nil
	})
	a.handle("DELETE /api/jobs/{id}", func(w http.ResponseWriter, r *http.Request, s *Session) error {
		id := r.PathValue("id")
		if !requestID.MatchString(id) {
			return fail(400, "Invalid job ID.")
		}
		err := a.Store.Transaction(r.Context(), func(tx *Store) error {
			job, e := tx.Get(r.Context(), "job", id, s.Owner)
			if e != nil {
				return e
			}
			if job == nil {
				exists, e := tx.Exists(r.Context(), "job", id)
				if e != nil {
					return e
				}
				if exists {
					return fail(404, "Job not found.")
				}
				old, e := tx.List(r.Context(), "cancel", s.Owner)
				if e != nil {
					return e
				}
				for i := 255; i < len(old); i++ {
					if e = tx.Remove(r.Context(), "cancel", str(old[i]["id"]), s.Owner); e != nil {
						return e
					}
				}
				_, e = tx.Put(r.Context(), "cancel", object{"id": id, "owner": s.Owner}, 0)
				return e
			}
			if job["status"] == "queued" {
				job["status"] = "cancelled"
				job["stage"] = "Cancelled"
				job["finishedAt"] = now()
				job["reservation"] = float64(0)
				_, e = tx.Put(r.Context(), "job", job, 0)
			} else if job["status"] == "running" {
				job["cancelRequested"] = true
				job["stage"] = "Cancelling"
				_, e = tx.Put(r.Context(), "job", job, int64(num(job["reservation"])))
			}
			return e
		})
		if err != nil {
			return err
		}
		write(w, 200, object{"cancelled": true})
		return nil
	})
	a.handle("DELETE /api/jobs/{id}/record", func(w http.ResponseWriter, r *http.Request, s *Session) error {
		err := a.Store.Transaction(r.Context(), func(tx *Store) error {
			job, err := tx.Need(r.Context(), "job", r.PathValue("id"), s.Owner)
			if err != nil {
				return err
			}
			if active(job) {
				return fail(409, "Cancel this job first.")
			}
			return tx.Remove(r.Context(), "job", str(job["id"]), s.Owner)
		})
		if err != nil {
			return err
		}
		write(w, 200, object{"deleted": true})
		return nil
	})
	a.handle("POST /api/jobs/{id}/apply", func(w http.ResponseWriter, r *http.Request, s *Session) error {
		var project object
		err := a.Store.Transaction(r.Context(), func(tx *Store) error {
			job, e := tx.Need(r.Context(), "job", r.PathValue("id"), s.Owner)
			if e != nil {
				return e
			}
			kind := str(job["type"])
			if job["status"] != "completed" || (kind != "analyze" && kind != "restore" && kind != "transcribe") || str(job["projectId"]) == "" {
				return fail(409, "This job has no editable result.")
			}
			project, e = tx.Need(r.Context(), "project", str(job["projectId"]), s.Owner)
			if e != nil {
				return e
			}
			if num(job["appliedVersion"]) > 0 {
				return nil
			}
			if project["version"] != job["baseVersion"] {
				return fail(409, "Project changed since this job started. Open it to review; current edits were preserved.")
			}
			data := obj(project["data"])
			if kind == "transcribe" {
				data["transcript"] = job["result"]
			} else {
				data["cuts"] = obj(job["result"])["cuts"]
			}
			cleaned, e := a.validateProject(r, tx, s.Owner, str(project["mediaId"]), data)
			if e != nil {
				return e
			}
			project["data"] = cleaned
			project["version"] = num(project["version"]) + 1
			project, e = tx.Put(r.Context(), "project", project, 0)
			if e != nil {
				return e
			}
			job["appliedVersion"] = project["version"]
			_, e = tx.Put(r.Context(), "job", job, 0)
			return e
		})
		if err != nil {
			return err
		}
		write(w, 200, publicProject(project))
		return nil
	})
}
