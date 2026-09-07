package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/QuokkaCompany/hypercut/internal/ai"
	"github.com/QuokkaCompany/hypercut/internal/cloud"
	"github.com/QuokkaCompany/hypercut/internal/local"
)

func env(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
func integer(key string, fallback int64) (int64, error) {
	return strconv.ParseInt(env(key, strconv.FormatInt(fallback, 10)), 10, 64)
}
func main() {
	if err := run(); err != nil {
		log.Print(err)
		os.Exit(1)
	}
}
func run() error {
	command := "serve"
	if len(os.Args) > 1 {
		command = os.Args[1]
	}
	root, err := filepath.Abs(env("HYPERCUT_ROOT", "."))
	if err != nil {
		return err
	}
	if command == "mcp" {
		ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
		defer stop()
		return ai.RunMCP(ctx)
	}
	if command == "local" {
		return runLocal(root)
	}
	directory := env("HYPERCUT_CLOUD_DATA", filepath.Join(root, ".hypercut/cloud"))
	if command == "user" {
		info, err := os.Stdin.Stat()
		if err != nil {
			return err
		}
		if len(os.Args) != 3 || info.Mode()&os.ModeCharDevice != 0 {
			return errors.New("Usage: pipe a password on stdin to hypercut-cloud user email@example.com. Never pass passwords as arguments.")
		}
		password, err := io.ReadAll(io.LimitReader(os.Stdin, 1030))
		if err != nil {
			return err
		}
		if len(password) >= 1030 {
			return errors.New("Password is too long.")
		}
		store, err := cloud.OpenStore(directory)
		if err != nil {
			return err
		}
		defer store.Close()
		_, err = store.CreateUser(context.Background(), os.Args[2], strings.TrimSuffix(strings.TrimSuffix(string(password), "\n"), "\r"))
		clear(password)
		if err != nil {
			return err
		}
		fmt.Println("Created account:", os.Args[2])
		return nil
	}
	port := env("PORT", "4328")
	publicURL := env("HYPERCUT_PUBLIC_URL", "http://127.0.0.1:"+port)
	if command == "healthcheck" {
		origin, err := url.Parse(publicURL)
		if err != nil {
			return err
		}
		ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
		defer cancel()
		req, err := http.NewRequestWithContext(ctx, "GET", "http://127.0.0.1:"+port+"/api/health", nil)
		if err != nil {
			return err
		}
		req.Host = origin.Host
		response, err := http.DefaultClient.Do(req)
		if err != nil {
			return err
		}
		response.Body.Close()
		if response.StatusCode != 200 {
			return errors.New("API is not ready.")
		}
		return nil
	}
	if command == "worker" {
		quota, err := integer("HYPERCUT_CLOUD_QUOTA_BYTES", 10*1024*1024*1024)
		if err != nil {
			return err
		}
		poll, err := integer("HYPERCUT_WORKER_POLL_MS", 500)
		if err != nil {
			return err
		}
		lease, err := integer("HYPERCUT_WORKER_LEASE_MS", 15000)
		if err != nil {
			return err
		}
		ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
		defer stop()
		fmt.Println("HyperCut Go worker ready.")
		return cloud.RunWorker(ctx, cloud.WorkerOptions{Root: root, DataDir: directory, Quota: quota, Poll: time.Duration(poll) * time.Millisecond, Lease: time.Duration(lease) * time.Millisecond})
	}
	if command != "serve" {
		return errors.New("Commands: serve, worker, user, healthcheck.")
	}
	quota, err := integer("HYPERCUT_CLOUD_QUOTA_BYTES", 10*1024*1024*1024)
	if err != nil {
		return err
	}
	maxUpload, err := integer("HYPERCUT_CLOUD_MAX_UPLOAD_BYTES", 2*1024*1024*1024)
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	api, err := cloud.New(context.Background(), cloud.Options{Root: root, DataDir: directory, DistDir: os.Getenv("HYPERCUT_DIST_DIR"), PublicURL: publicURL, Quota: quota, MaxUpload: maxUpload})
	if err != nil {
		return err
	}
	defer api.Close()
	server := &http.Server{Addr: net.JoinHostPort(env("HYPERCUT_CLOUD_HOST", "127.0.0.1"), port), Handler: api, ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 2 * time.Minute, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 32 * 1024}
	listener, err := net.Listen("tcp", server.Addr)
	if err != nil {
		return err
	}
	done := make(chan error, 1)
	go func() { done <- server.Serve(listener) }()
	fmt.Println("HyperCut Go cloud API ready at", publicURL)
	select {
	case err = <-done:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
		return nil
	case <-ctx.Done():
	}
	shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	err = server.Shutdown(shutdown)
	if err != nil {
		_ = server.Close()
	}
	return nil
}

func runLocal(root string) error {
	parentPID := os.Getppid()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if os.Getenv("HYPERCUT_DESKTOP_TOKEN") != "" {
		go func() {
			t := time.NewTicker(time.Second)
			defer t.Stop()
			for {
				select {
				case <-ctx.Done():
					return
				case <-t.C:
					if os.Getppid() != parentPID {
						stop()
						return
					}
				}
			}
		}()
	}
	app, err := local.New(context.Background(), local.Options{Root: root, DataDir: os.Getenv("HYPERCUT_DATA_DIR"), DistDir: os.Getenv("HYPERCUT_DIST_DIR"), DesktopToken: os.Getenv("HYPERCUT_DESKTOP_TOKEN"), Development: os.Getenv("HYPERCUT_DEVELOPMENT") == "1"})
	if err != nil {
		return err
	}
	defer app.Close()
	listener, err := net.Listen("tcp", "127.0.0.1:"+env("PORT", "4327"))
	if err != nil {
		return err
	}
	server := &http.Server{Handler: app, ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 32 * 1024}
	done := make(chan error, 1)
	go func() { done <- server.Serve(listener) }()
	fmt.Println("HYPERCUT_LOCAL_READY http://" + listener.Addr().String())
	select {
	case err = <-done:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
		return nil
	case <-ctx.Done():
	}
	app.Close()
	return server.Close()
}
