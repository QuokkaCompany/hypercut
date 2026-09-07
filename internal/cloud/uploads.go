package cloud

import (
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

func publicUpload(x object) object {
	result := selectFields(x, "id", "name", "size", "kind", "offset", "hashes", "result")
	result["chunkBytes"] = ChunkBytes
	return result
}
func (a *API) uploadLock(fn handler) handler {
	return func(w http.ResponseWriter, r *http.Request, s *Session) error {
		id := r.PathValue("id")
		a.mu.Lock()
		if a.uploads[id] {
			a.mu.Unlock()
			return fail(409, "Upload is busy. Retry this request.")
		}
		a.uploads[id] = true
		a.mu.Unlock()
		defer func() { a.mu.Lock(); delete(a.uploads, id); a.mu.Unlock() }()
		return fn(w, r, s)
	}
}
func (a *API) uploadDir(id string) string { return filepath.Join(a.Store.Directory, "uploads", id) }
func (a *API) installUploads() {
	a.handle("POST /api/uploads", func(w http.ResponseWriter, r *http.Request, s *Session) error {
		input, err := body(r)
		if err != nil {
			return err
		}
		name, kind := str(input["name"]), str(input["kind"])
		if input["kind"] == nil {
			kind = "media"
		}
		if name == "" || jsLength(name) > 255 || strings.IndexFunc(name, func(c rune) bool { return c < 32 }) >= 0 {
			return fail(400, "Invalid filename.")
		}
		size := int64(num(input["size"]))
		limit := a.options.MaxUpload
		if kind == "effect" && limit > 1024*1024*1024 {
			limit = 1024 * 1024 * 1024
		}
		if (kind != "media" && kind != "effect") || !integer(input["size"]) || size <= 0 || size > limit {
			return fail(413, "File exceeds the upload limit.")
		}
		item := object{"id": uuid(), "owner": s.Owner, "name": filepath.Base(name), "size": number(size), "kind": kind, "offset": float64(0), "hashes": []any{}, "createdAt": now()}
		err = a.Store.Transaction(r.Context(), func(tx *Store) error {
			used, e := tx.Usage(r.Context(), s.Owner)
			if e != nil {
				return e
			}
			if used+size > a.options.Quota {
				return fail(413, "Account storage quota exceeded. Remove unused files first.")
			}
			uploads, e := tx.List(r.Context(), "upload", s.Owner)
			if e != nil {
				return e
			}
			count := 0
			for _, x := range uploads {
				if x["result"] == nil {
					count++
				}
			}
			if count >= 8 {
				return fail(429, "Too many incomplete uploads.")
			}
			_, e = tx.Put(r.Context(), "upload", item, size)
			return e
		})
		if err != nil {
			return err
		}
		write(w, 201, publicUpload(item))
		return nil
	})
	a.handle("GET /api/uploads", func(w http.ResponseWriter, r *http.Request, s *Session) error {
		items, err := a.Store.List(r.Context(), "upload", s.Owner)
		if err != nil {
			return err
		}
		result := []object{}
		for _, item := range items {
			if item["result"] == nil {
				result = append(result, publicUpload(item))
			}
		}
		write(w, 200, result)
		return nil
	})
	a.handle("GET /api/uploads/{id}", func(w http.ResponseWriter, r *http.Request, s *Session) error {
		item, err := a.Store.Need(r.Context(), "upload", r.PathValue("id"), s.Owner)
		if err != nil {
			return err
		}
		write(w, 200, publicUpload(item))
		return nil
	})
	a.handle("PUT /api/uploads/{id}/chunks/{offset}", a.uploadLock(a.putChunk))
	a.handle("POST /api/uploads/{id}/complete", a.uploadLock(a.completeUpload))
	a.handle("DELETE /api/uploads/{id}", a.uploadLock(func(w http.ResponseWriter, r *http.Request, s *Session) error {
		item, err := a.Store.Need(r.Context(), "upload", r.PathValue("id"), s.Owner)
		if err != nil {
			return err
		}
		if item["result"] != nil {
			return fail(409, "Completed uploads are managed in the media library.")
		}
		if err = os.RemoveAll(a.uploadDir(str(item["id"]))); err != nil {
			return err
		}
		if err = a.Store.Remove(r.Context(), "upload", str(item["id"]), s.Owner); err != nil {
			return err
		}
		write(w, 200, object{"deleted": true})
		return nil
	}))
}
func (a *API) putChunk(w http.ResponseWriter, r *http.Request, s *Session) error {
	item, err := a.Store.Need(r.Context(), "upload", r.PathValue("id"), s.Owner)
	if err != nil {
		return err
	}
	content, _, e := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if item["result"] != nil || e != nil || content != "application/octet-stream" {
		return fail(400, "Invalid upload chunk.")
	}
	offset, e := strconv.ParseInt(r.PathValue("offset"), 10, 64)
	if e != nil || offset < 0 || offset%ChunkBytes != 0 {
		return fail(400, "Invalid chunk offset.")
	}
	data, e := io.ReadAll(http.MaxBytesReader(w, r.Body, ChunkBytes))
	if e != nil {
		return e
	}
	if len(data) == 0 {
		return fail(400, "Invalid upload chunk.")
	}
	digest := hash(data)
	if r.Header.Get("X-Content-SHA256") != digest {
		return fail(400, "Chunk digest mismatch.")
	}
	hashes := array(item["hashes"])
	committed := int64(num(item["offset"]))
	size := int64(num(item["size"]))
	if offset < committed {
		index := int(offset / ChunkBytes)
		if index >= len(hashes) || hashes[index] != digest {
			return fail(409, "Previously uploaded chunk differs.")
		}
		write(w, 200, publicUpload(item))
		return nil
	}
	expected := size - offset
	if expected > ChunkBytes {
		expected = ChunkBytes
	}
	if offset != committed || int64(len(data)) != expected {
		return fail(409, "Resume from the committed offset.")
	}
	directory := a.uploadDir(str(item["id"]))
	if err = os.MkdirAll(directory, 0700); err != nil {
		return err
	}
	target := filepath.Join(directory, strconv.FormatInt(offset, 10))
	tmp := target + ".tmp"
	if err = durableFile(tmp, data); err != nil {
		return err
	}
	if err = os.Rename(tmp, target); err != nil {
		return err
	}
	if err = syncDir(directory); err != nil {
		return err
	}
	item["offset"] = number(offset + int64(len(data)))
	item["hashes"] = append(hashes, digest)
	if _, err = a.Store.Put(r.Context(), "upload", item, size); err != nil {
		return err
	}
	write(w, 200, publicUpload(item))
	return nil
}
func durableFile(file string, data []byte) error {
	f, err := os.OpenFile(file, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0600)
	if err != nil {
		return err
	}
	defer f.Close()
	if _, err = f.Write(data); err != nil {
		return err
	}
	return f.Sync()
}
func syncDir(directory string) error {
	f, err := os.Open(directory)
	if err != nil {
		return err
	}
	defer f.Close()
	return f.Sync()
}
func (a *API) completeUpload(w http.ResponseWriter, r *http.Request, s *Session) error {
	item, err := a.Store.Need(r.Context(), "upload", r.PathValue("id"), s.Owner)
	if err != nil {
		return err
	}
	if item["result"] != nil {
		write(w, 200, item["result"])
		return nil
	}
	if item["offset"] != item["size"] {
		return fail(409, "Upload is incomplete.")
	}
	directory := a.uploadDir(str(item["id"]))
	target := filepath.Join(directory, "source")
	f, err := os.OpenFile(target, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	hashes := array(item["hashes"])
	size := int64(num(item["size"]))
	published := false
	defer func() {
		if !published {
			_ = os.Remove(target)
		}
	}()
	err = func() error {
		defer f.Close()
		for offset := int64(0); offset < size; offset += ChunkBytes {
			if err := r.Context().Err(); err != nil {
				return err
			}
			data, err := os.ReadFile(filepath.Join(directory, strconv.FormatInt(offset, 10)))
			if err != nil {
				return err
			}
			index := int(offset / ChunkBytes)
			if index >= len(hashes) || hash(data) != hashes[index] {
				return fail(409, "Stored chunk is damaged. Restart the upload.")
			}
			if _, err = f.Write(data); err != nil {
				return err
			}
		}
		return f.Sync()
	}()
	if err != nil {
		return err
	}
	result, err := a.rpc(r, object{"op": "inspect", "input": object{"file": target, "name": item["name"], "kind": item["kind"]}}, 30*time.Minute)
	if err != nil {
		return err
	}
	asset := obj(obj(result)["asset"])
	if str(asset["id"]) == "" {
		return fail(502, "Invalid media inspection result.")
	}
	asset["owner"] = s.Owner
	item["result"] = obj(result)["public"]
	err = a.Store.Transaction(r.Context(), func(tx *Store) error {
		if _, err := tx.Put(r.Context(), str(item["kind"]), asset, size); err != nil {
			return err
		}
		_, err := tx.Put(r.Context(), "upload", item, 0)
		return err
	})
	if err != nil {
		return err
	}
	published = true
	for offset := int64(0); offset < size; offset += ChunkBytes {
		if err = os.Remove(filepath.Join(directory, fmt.Sprint(offset))); err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	write(w, 200, item["result"])
	return nil
}
