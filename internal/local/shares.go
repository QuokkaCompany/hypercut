package local

import (
	"net/http"
	"os"
	"strings"
)

func (s *Server) shareRoute(w http.ResponseWriter, r *http.Request) error {
	p := r.URL.Path
	in := Object{}
	var e error
	if r.Method == "POST" {
		in, e = input(w, r, 128*1024)
		if e != nil {
			return e
		}
	}
	id, action := "", "owner"
	if strings.HasPrefix(p, "/api/mcp-exchange/") {
		suffix := strings.TrimPrefix(p, "/api/mcp-exchange/")
		id = strings.TrimSuffix(suffix, "/proposals")
		action = "exchange"
		if strings.HasSuffix(suffix, "/proposals") {
			action = "proposals"
		}
		if (action == "exchange" && r.Method != "GET") || (action == "proposals" && r.Method != "POST") {
			write(w, 404, Object{"error": "Unknown exchange route"})
			return nil
		}
	} else {
		suffix := strings.TrimPrefix(p, "/api/ai/shares")
		id = strings.TrimPrefix(suffix, "/")
		if strings.HasSuffix(id, "/resolution") {
			id = strings.TrimSuffix(id, "/resolution")
			action = "resolution"
		}
	}
	v, e := s.shares.Handle(r.Method, id, action, r.Header.Get("X-Hypercut-Share-Capability"), in)
	if e != nil {
		return e
	}
	if id == "" && r.Method == "POST" {
		exe, e := os.Executable()
		if e != nil {
			return e
		}
		v["connection"] = Object{"command": exe, "args": []string{"mcp"}, "env": Object{"HYPERCUT_MCP_URL": "http://" + r.Host, "HYPERCUT_MCP_SHARE": v["shareId"], "HYPERCUT_MCP_CAPABILITY": v["capability"]}}
	}
	write(w, 200, v)
	return nil
}
