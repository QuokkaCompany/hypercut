package cloud

import (
	"context"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func (a *API) validateProject(r *http.Request, s *Store, owner, mediaID string, data any) (any, error) {
	media, err := s.Need(r.Context(), "media", mediaID, owner)
	if err != nil {
		return nil, err
	}
	effects := []object{}
	for _, value := range array(obj(obj(data)["effects"])["assets"]) {
		asset, err := s.Need(r.Context(), "effect", str(obj(value)["id"]), owner)
		if err != nil {
			return nil, err
		}
		effects = append(effects, asset)
	}
	return a.rpc(r, object{"op": "validate-project", "media": media, "effects": effects, "input": data}, 30*time.Second)
}
func (a *API) installProjects() {
	a.handle("GET /api/projects", func(w http.ResponseWriter, r *http.Request, s *Session) error {
		items, err := a.Store.List(r.Context(), "project", s.Owner)
		if err != nil {
			return err
		}
		result := []object{}
		for _, item := range items {
			result = append(result, publicProject(item))
		}
		write(w, 200, result)
		return nil
	})
	a.handle("GET /api/projects/{id}", func(w http.ResponseWriter, r *http.Request, s *Session) error {
		item, err := a.Store.Need(r.Context(), "project", r.PathValue("id"), s.Owner)
		if err != nil {
			return err
		}
		write(w, 200, publicProject(item))
		return nil
	})
	save := func(w http.ResponseWriter, r *http.Request, s *Session) error {
		input, err := body(r)
		if err != nil {
			return err
		}
		name := str(input["name"])
		if strings.TrimSpace(name) == "" || jsLength(name) > 200 {
			return fail(400, "Project name must contain 1–200 characters.")
		}
		id := r.PathValue("id")
		var item object
		err = a.Store.Transaction(r.Context(), func(tx *Store) error {
			version := float64(0)
			if id != "" {
				old, e := tx.Need(r.Context(), "project", id, s.Owner)
				if e != nil {
					return e
				}
				if old["version"] != input["version"] {
					return fail(409, "Project changed in another tab. Reopen it before saving.")
				}
				version = num(old["version"])
			} else {
				items, e := tx.List(r.Context(), "project", s.Owner)
				if e != nil {
					return e
				}
				if len(items) >= 100 {
					return fail(429, "Project limit reached.")
				}
				id = uuid()
			}
			data, e := a.validateProject(r, tx, s.Owner, str(input["mediaId"]), input["data"])
			if e != nil {
				return e
			}
			item, e = tx.Put(r.Context(), "project", object{"id": id, "owner": s.Owner, "name": strings.TrimSpace(name), "mediaId": input["mediaId"], "data": data, "version": version + 1}, 0)
			return e
		})
		if err != nil {
			return err
		}
		status := 200
		if r.Method == "POST" {
			status = 201
		}
		write(w, status, publicProject(item))
		return nil
	}
	a.handle("POST /api/projects", save)
	a.handle("PUT /api/projects/{id}", save)
	a.handle("DELETE /api/projects/{id}", func(w http.ResponseWriter, r *http.Request, s *Session) error {
		err := a.Store.Transaction(r.Context(), func(tx *Store) error {
			item, err := tx.Need(r.Context(), "project", r.PathValue("id"), s.Owner)
			if err != nil {
				return err
			}
			jobs, err := tx.List(r.Context(), "job", s.Owner)
			if err != nil {
				return err
			}
			for _, job := range jobs {
				if job["projectId"] == item["id"] && active(job) {
					return fail(409, "Cancel project jobs first.")
				}
			}
			return tx.Remove(r.Context(), "project", str(item["id"]), s.Owner)
		})
		if err != nil {
			return err
		}
		write(w, 200, object{"deleted": true})
		return nil
	})
}
func usesEffect(value any, id string) bool {
	for _, x := range array(obj(value)["assets"]) {
		if obj(x)["id"] == id {
			return true
		}
	}
	return false
}
func (a *API) deleteAsset(w http.ResponseWriter, r *http.Request, s *Session, kind string) error {
	var item object
	err := a.Store.Transaction(r.Context(), func(tx *Store) error {
		var err error
		item, err = tx.Need(r.Context(), kind, r.PathValue("id"), s.Owner)
		if err != nil {
			return err
		}
		id := str(item["id"])
		if kind != "export" {
			jobs, err := tx.List(r.Context(), "job", s.Owner)
			if err != nil {
				return err
			}
			for _, job := range jobs {
				if active(job) && ((kind == "media" && job["mediaId"] == id) || (kind == "effect" && usesEffect(obj(job["input"])["effects"], id))) {
					return fail(409, "An active job uses this file.")
				}
			}
			projects, err := tx.List(r.Context(), "project", s.Owner)
			if err != nil {
				return err
			}
			for _, project := range projects {
				if (kind == "media" && project["mediaId"] == id) || (kind == "effect" && usesEffect(obj(project["data"])["effects"], id)) {
					return fail(409, "A saved project uses this file.")
				}
			}
		}
		_, err = tx.q.ExecContext(r.Context(), "UPDATE records SET data=json_set(data,'$.deleting',1) WHERE kind=? AND id=? AND owner=?", kind, id, s.Owner)
		return err
	})
	if err != nil {
		return err
	}
	if err = os.Remove(str(item["path"])); err != nil && !os.IsNotExist(err) {
		_, _ = a.Store.q.ExecContext(context.Background(), "UPDATE records SET data=json_remove(data,'$.deleting') WHERE kind=? AND id=? AND owner=?", kind, item["id"], s.Owner)
		return err
	}
	if kind == "media" {
		_, _ = a.rpc(r, object{"op": "forget-playback", "input": object{"id": item["id"]}}, 5*time.Second)
		if err = os.RemoveAll(filepath.Join(a.Store.Directory, "playback", str(item["id"]))); err != nil {
			return err
		}
	}
	if err = a.Store.Remove(r.Context(), kind, str(item["id"]), s.Owner); err != nil {
		return err
	}
	uploads, err := a.Store.List(r.Context(), "upload", s.Owner)
	if err != nil {
		return err
	}
	for _, upload := range uploads {
		if obj(upload["result"])["id"] == item["id"] {
			if err = os.RemoveAll(filepath.Join(a.Store.Directory, "uploads", str(upload["id"]))); err != nil {
				return err
			}
			if err = a.Store.Remove(r.Context(), "upload", str(upload["id"]), s.Owner); err != nil {
				return err
			}
		}
	}
	write(w, 200, object{"deleted": true})
	return nil
}
