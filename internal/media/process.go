package media

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"syscall"
	"time"
)

type tail struct{ b []byte }

func (t *tail) Write(p []byte) (int, error) {
	n := len(p)
	t.b = append(t.b, p...)
	if len(t.b) > 32768 {
		t.b = t.b[len(t.b)-32768:]
	}
	return n, nil
}
func executable(name string) string {
	if name == "ffmpeg" && os.Getenv("FFMPEG_PATH") != "" {
		return os.Getenv("FFMPEG_PATH")
	}
	if name == "ffprobe" && os.Getenv("FFPROBE_PATH") != "" {
		return os.Getenv("FFPROBE_PATH")
	}
	return name
}

// Subprocess groups are cancelled together; bounded stderr cannot exhaust memory.
func Stream(ctx context.Context, name string, args []string, consume func(io.Reader) error) error {
	child, cancel := context.WithCancel(ctx)
	defer cancel()
	cmd := exec.CommandContext(child, executable(name), args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error { return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL) }
	cmd.WaitDelay = 2 * time.Second
	stderr := &tail{}
	cmd.Stderr = stderr
	stdout, e := cmd.StdoutPipe()
	if e != nil {
		return e
	}
	if e = cmd.Start(); e != nil {
		return e
	}
	readErr := consume(stdout)
	if readErr != nil {
		cancel()
	}
	e = cmd.Wait()
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if readErr != nil {
		return readErr
	}
	if e != nil {
		return fmt.Errorf("%s failed: %s", name, strings.TrimSpace(string(stderr.b)))
	}
	return nil
}
func Capture(ctx context.Context, name string, args ...string) ([]byte, error) {
	var b bytes.Buffer
	e := Stream(ctx, name, args, func(r io.Reader) error {
		_, e := io.Copy(&b, io.LimitReader(r, 64*1024*1024+1))
		if b.Len() > 64*1024*1024 {
			return fmt.Errorf("Process output too large")
		}
		return e
	})
	return b.Bytes(), e
}
