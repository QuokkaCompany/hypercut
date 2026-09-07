package local

import (
	"context"
	"encoding/json"
	"fmt"
	m "github.com/QuokkaCompany/hypercut/internal/media"
	"io"
	"os"
	"path/filepath"
)

func (s *Server) protect(target string) error {
	absolute, e := filepath.Abs(target)
	if e != nil {
		return e
	}
	real, e := filepath.EvalSymlinks(absolute)
	if e != nil {
		real = absolute
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	sources := []Object{}
	for _, v := range s.media {
		sources = append(sources, v)
	}
	for _, v := range s.effects {
		sources = append(sources, v)
	}
	for _, v := range sources {
		path, e := filepath.EvalSymlinks(str(v["path"]))
		if e != nil {
			path = str(v["path"])
		}
		if path == real {
			return fmt.Errorf("원본 영상과 다른 이름으로 저장해 주세요. 효과음 원본도 덮어쓸 수 없습니다.")
		}
		sourceInfo, a := os.Stat(path)
		targetInfo, b := os.Stat(absolute)
		if a == nil && b == nil && os.SameFile(sourceInfo, targetInfo) {
			return fmt.Errorf("원본 파일을 덮어쓸 수 없습니다.")
		}
	}
	return nil
}
func atomicWrite(target string, fn func(*os.File) error) error {
	dir := filepath.Dir(target)
	f, e := os.CreateTemp(dir, ".hypercut-save-")
	if e != nil {
		return e
	}
	temp := f.Name()
	defer os.Remove(temp)
	if e = fn(f); e == nil {
		e = f.Sync()
	}
	closeErr := f.Close()
	if e != nil {
		return e
	}
	if closeErr != nil {
		return closeErr
	}
	if e = os.Rename(temp, target); e != nil {
		return e
	}
	d, e := os.Open(dir)
	if e != nil {
		return e
	}
	defer d.Close()
	return d.Sync()
}
func (s *Server) desktop(ctx context.Context, in Object) (any, error) {
	switch str(in["op"]) {
	case "registerFile", "registerEffect":
		path := str(in["path"])
		if !filepath.IsAbs(path) {
			return nil, fmt.Errorf("Choose an absolute file path")
		}
		effect := str(in["op"]) == "registerEffect"
		return s.register(ctx, path, str(in["name"]), effect)
	case "export":
		s.mu.Lock()
		v := s.exports[str(in["id"])]
		if v != nil {
			v = m.Copy(v)
		}
		s.mu.Unlock()
		if v == nil {
			return nil, fmt.Errorf("저장할 결과물을 찾을 수 없습니다.")
		}
		delete(v, "path")
		return v, nil
	case "validateProject":
		return m.Project(obj(in["project"]), nil, nil)
	case "saveProject", "saveExport":
		target := str(in["path"])
		if !filepath.IsAbs(target) {
			return nil, fmt.Errorf("Choose an absolute save path")
		}
		if e := s.protect(target); e != nil {
			return nil, e
		}
		if str(in["op"]) == "saveProject" {
			v, e := m.Project(obj(in["project"]), nil, nil)
			if e != nil {
				return nil, e
			}
			b, e := json.MarshalIndent(v, "", "  ")
			if e != nil {
				return nil, e
			}
			e = atomicWrite(target, func(f *os.File) error {
				if e := ctx.Err(); e != nil {
					return e
				}
				_, e := f.Write(b)
				return e
			})
			return true, e
		}
		s.mu.Lock()
		output := s.exports[str(in["id"])]
		s.mu.Unlock()
		if output == nil {
			return nil, fmt.Errorf("저장할 결과물을 찾을 수 없습니다.")
		}
		source, e := os.Open(str(output["path"]))
		if e != nil {
			return nil, e
		}
		defer source.Close()
		e = atomicWrite(target, func(f *os.File) error {
			if e := ctx.Err(); e != nil {
				return e
			}
			_, e := io.Copy(f, source)
			return e
		})
		return true, e
	}
	return nil, fmt.Errorf("Unknown desktop operation")
}
