package cloud

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"syscall"
	"time"
)

type Bridge struct {
	client    *http.Client
	cmd       *exec.Cmd
	directory string
	done      chan struct{}
	once      sync.Once
}

func StartBridge(ctx context.Context, root, node string) (*Bridge, error) {
	directory, err := os.MkdirTemp("/tmp", "hypercut-rpc-")
	if err != nil {
		return nil, err
	}
	socket := filepath.Join(directory, "media.sock")
	cmd := exec.Command(node, filepath.Join(root, "server/cloud/media-bridge.mjs"), socket)
	cmd.Dir = root
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	// The bridge logs no request bodies; only startup/runtime diagnostics go to stderr.
	cmd.Stderr = os.Stderr
	transport := &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "unix", socket)
	}}
	b := &Bridge{client: &http.Client{Transport: transport}, cmd: cmd, directory: directory, done: make(chan struct{})}
	if err = cmd.Start(); err != nil {
		os.RemoveAll(directory)
		return nil, err
	}
	go func() { _ = cmd.Wait(); close(b.done) }()
	startup, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	for {
		req, _ := http.NewRequestWithContext(startup, "GET", "http://media/health", nil)
		res, e := b.client.Do(req)
		if e == nil {
			res.Body.Close()
			if res.StatusCode == 200 {
				return b, nil
			}
		}
		select {
		case <-b.done:
			b.Close()
			return nil, errors.New("Media helper exited during startup.")
		case <-startup.Done():
			b.Close()
			return nil, startup.Err()
		case <-time.After(30 * time.Millisecond):
		}
	}
}
func (b *Bridge) Close() {
	b.once.Do(func() {
		if b.cmd.Process != nil {
			_ = b.cmd.Process.Signal(syscall.SIGTERM)
		}
		select {
		case <-b.done:
		case <-time.After(5 * time.Second):
			_ = syscall.Kill(-b.cmd.Process.Pid, syscall.SIGKILL)
			<-b.done
		}
		b.client.CloseIdleConnections()
		_ = os.RemoveAll(b.directory)
	})
}
func (b *Bridge) Call(ctx context.Context, body object) (any, error) {
	data, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, "POST", "http://media/bridge", bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	result, err := b.client.Do(req)
	if err != nil {
		return nil, fail(503, "Media helper is unavailable. Restart the API and retry.")
	}
	defer result.Body.Close()
	bytes, err := io.ReadAll(io.LimitReader(result.Body, 64*1024*1024+1))
	if err != nil {
		return nil, err
	}
	if len(bytes) > 64*1024*1024 {
		return nil, fail(502, "Media response is too large.")
	}
	var value any
	if err = json.Unmarshal(bytes, &value); err != nil {
		return nil, fail(502, "Invalid media response.")
	}
	if result.StatusCode != 200 {
		return nil, fail(result.StatusCode, str(obj(value)["error"]))
	}
	return value, nil
}
func (b *Bridge) AI(w http.ResponseWriter, r *http.Request, session *Session) error {
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Minute)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, r.Method, "http://media"+r.URL.RequestURI(), r.Body)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Hypercut-Session", session.ID)
	req.Header.Set("X-Hypercut-Session-Expires", fmt.Sprint(session.Expires))
	response, err := b.client.Do(req)
	if err != nil {
		return fail(503, "Media helper is unavailable. Restart the API and reconnect AI.")
	}
	defer response.Body.Close()
	// Copy only a bounded JSON response, never helper transport/cookie headers.
	data, err := io.ReadAll(io.LimitReader(response.Body, 12*1024*1024+1))
	if err != nil {
		return err
	}
	if len(data) > 12*1024*1024 {
		return fail(502, "AI response is too large.")
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(response.StatusCode)
	_, err = w.Write(data)
	return err
}
