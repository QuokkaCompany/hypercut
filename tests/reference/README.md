# Pre-migration reference implementation

This directory contains the former JavaScript backend solely for differential tests and historical regression fixtures. It is not copied into production containers or desktop packages and is not invoked by production commands. The production backend is implemented in `internal/` and `cmd/` in Go.

Reference tests alone do not establish Go behavior. Run the Go race/media tests, `test:local:go`, `test:cloud:go`, `test:cloud:go:e2e` and native Go backend acceptance explicitly. Legacy tests with injected JavaScript providers cannot cross the Go process boundary; native Go AI tests provide controlled transports instead.
