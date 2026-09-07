package cloud

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
	"unicode/utf16"

	"golang.org/x/crypto/scrypt"
	_ "modernc.org/sqlite"
)

type object map[string]any

func str(v any) string  { s, _ := v.(string); return s }
func num(v any) float64 { n, _ := v.(float64); return n }
func obj(v any) object {
	switch x := v.(type) {
	case object:
		return x
	case map[string]any:
		return object(x)
	}
	return object{}
}
func array(v any) []any       { a, _ := v.([]any); return a }
func number(v int64) float64  { return float64(v) }
func now() float64            { return number(time.Now().UnixMilli()) }
func jsLength(s string) int   { return len(utf16.Encode([]rune(s))) }
func hash(data []byte) string { d := sha256.Sum256(data); return hex.EncodeToString(d[:]) }
func randomHex() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}
func uuid() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	b[6] = (b[6] & 15) | 64
	b[8] = (b[8] & 63) | 128
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[:4], b[4:6], b[6:8], b[8:10], b[10:])
}

var requestID = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

type HTTPError struct {
	Status  int
	Message string
}

func (e *HTTPError) Error() string { return e.Message }
func check(ok bool, status int, message string) error {
	if !ok {
		return &HTTPError{status, message}
	}
	return nil
}
func fail(status int, message string) error { return &HTTPError{status, message} }

type querier interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}
type Store struct {
	db        *sql.DB
	q         querier
	Directory string
}

func OpenStore(directory string) (*Store, error) {
	directory, err := filepath.Abs(directory)
	if err != nil {
		return nil, err
	}
	if err = os.MkdirAll(directory, 0700); err != nil {
		return nil, err
	}
	file := filepath.Join(directory, "cloud.sqlite")
	// Create with restrictive permissions before SQLite can write account data.
	f, err := os.OpenFile(file, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	f.Close()
	if err = os.Chmod(file, 0600); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", file)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	s := &Store{db: db, q: db, Directory: directory}
	var version int
	if err = db.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		db.Close()
		return nil, err
	}
	if version > 1 {
		db.Close()
		return nil, errors.New("Database schema is newer than this HyperCut version.")
	}
	_, err = db.Exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
 CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, salt TEXT NOT NULL, hash TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES users(id), csrf TEXT NOT NULL, expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, owner TEXT NOT NULL REFERENCES users(id), data TEXT NOT NULL, size INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1, created INTEGER NOT NULL, PRIMARY KEY(kind,id));
 CREATE INDEX IF NOT EXISTS records_owner ON records(owner,kind,created);
 CREATE INDEX IF NOT EXISTS session_expiry ON sessions(expires);
 PRAGMA user_version=1;`)
	if err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}
func (s *Store) Close() error { return s.db.Close() }
func (s *Store) Transaction(ctx context.Context, fn func(*Store) error) error {
	conn, err := s.db.Conn(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()
	if _, err = conn.ExecContext(ctx, "BEGIN IMMEDIATE"); err != nil {
		return err
	}
	defer conn.ExecContext(context.Background(), "ROLLBACK")
	if err = fn(&Store{db: s.db, q: conn, Directory: s.Directory}); err != nil {
		return err
	}
	_, err = conn.ExecContext(ctx, "COMMIT")
	return err
}

type scanner interface{ Scan(...any) error }

func decode(row scanner) (object, error) {
	var id, owner, data string
	var version, created int64
	if err := row.Scan(&id, &owner, &data, &version, &created); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	var value object
	if err := json.Unmarshal([]byte(data), &value); err != nil {
		return nil, err
	}
	value["id"] = id
	value["owner"] = owner
	value["version"] = number(version)
	value["createdAt"] = number(created)
	return value, nil
}
func (s *Store) Get(ctx context.Context, kind, id, owner string) (object, error) {
	return decode(s.q.QueryRowContext(ctx, "SELECT id,owner,data,version,created FROM records WHERE kind=? AND id=? AND owner=?", kind, id, owner))
}
func (s *Store) Need(ctx context.Context, kind, id, owner string) (object, error) {
	x, err := s.Get(ctx, kind, id, owner)
	if err != nil {
		return nil, err
	}
	if x == nil || x["deleting"] == true || num(x["deleting"]) == 1 {
		return nil, fail(404, "Record not found.")
	}
	return x, nil
}
func (s *Store) List(ctx context.Context, kind, owner string) ([]object, error) {
	rows, err := s.q.QueryContext(ctx, "SELECT id,owner,data,version,created FROM records WHERE kind=? AND owner=? ORDER BY created DESC", kind, owner)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []object{}
	for rows.Next() {
		item, err := decode(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}
func (s *Store) Put(ctx context.Context, kind string, item object, size int64) (object, error) {
	data, err := json.Marshal(item)
	if err != nil {
		return nil, err
	}
	version, created := num(item["version"]), num(item["createdAt"])
	if version == 0 {
		version = 1
	}
	if created == 0 {
		created = now()
	}
	_, err = s.q.ExecContext(ctx, `INSERT INTO records(kind,id,owner,data,size,version,created) VALUES(?,?,?,?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data,size=excluded.size,version=excluded.version`, kind, item["id"], item["owner"], string(data), size, version, created)
	if err != nil {
		return nil, err
	}
	return s.Get(ctx, kind, str(item["id"]), str(item["owner"]))
}
func (s *Store) Remove(ctx context.Context, kind, id, owner string) error {
	_, err := s.q.ExecContext(ctx, "DELETE FROM records WHERE kind=? AND id=? AND owner=?", kind, id, owner)
	return err
}
func (s *Store) Usage(ctx context.Context, owner string) (int64, error) {
	var n int64
	err := s.q.QueryRowContext(ctx, "SELECT coalesce(sum(size),0) FROM records WHERE owner=?", owner).Scan(&n)
	return n, err
}
func (s *Store) Exists(ctx context.Context, kind, id string) (bool, error) {
	var n int
	err := s.q.QueryRowContext(ctx, "SELECT count(*) FROM records WHERE kind=? AND id=?", kind, id).Scan(&n)
	return n > 0, err
}

var emailPattern = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)

func (s *Store) CreateUser(ctx context.Context, email, password string) (object, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	if !emailPattern.MatchString(email) || jsLength(email) > 254 {
		return nil, fail(400, "Enter a valid email address.")
	}
	if jsLength(password) < 12 || jsLength(password) > 256 {
		return nil, fail(400, "Use a password of 12–256 characters.")
	}
	salt := randomHex()
	key, err := scrypt.Key([]byte(password), []byte(salt), 16384, 8, 1, 64)
	if err != nil {
		return nil, err
	}
	id := uuid()
	_, err = s.q.ExecContext(ctx, "INSERT INTO users VALUES(?,?,?,?)", id, email, salt, hex.EncodeToString(key))
	return object{"id": id, "email": email}, err
}
func (s *Store) Authenticate(ctx context.Context, email, password any) (object, error) {
	e, ok := email.(string)
	p, ok2 := password.(string)
	if !ok || !ok2 || jsLength(e) > 254 || jsLength(p) > 256 {
		return nil, fail(401, "Invalid email or password.")
	}
	var id, canonical, salt, encoded string
	err := s.q.QueryRowContext(ctx, "SELECT id,email,salt,hash FROM users WHERE email=?", strings.ToLower(strings.TrimSpace(e))).Scan(&id, &canonical, &salt, &encoded)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	if id == "" {
		salt = "hypercut-unknown-account"
	}
	key, err := scrypt.Key([]byte(p), []byte(salt), 16384, 8, 1, 64)
	if err != nil {
		return nil, err
	}
	expected, _ := hex.DecodeString(encoded)
	if subtle.ConstantTimeCompare(key, expected) != 1 || id == "" {
		return nil, fail(401, "Invalid email or password.")
	}
	return object{"id": id, "email": canonical}, nil
}

type Session struct {
	ID, Owner, Email, CSRF string
	Expires                int64
}

func (s *Store) NewSession(ctx context.Context, owner string) (string, *Session, error) {
	cookie := randomHex()
	session := &Session{ID: hash([]byte(cookie)), Owner: owner, CSRF: randomHex(), Expires: time.Now().Add(12 * time.Hour).UnixMilli()}
	err := s.Transaction(ctx, func(tx *Store) error {
		if _, err := tx.q.ExecContext(ctx, "DELETE FROM sessions WHERE expires<?", time.Now().UnixMilli()); err != nil {
			return err
		}
		_, err := tx.q.ExecContext(ctx, "INSERT INTO sessions VALUES(?,?,?,?)", session.ID, owner, session.CSRF, session.Expires)
		return err
	})
	return cookie, session, err
}
func (s *Store) Session(ctx context.Context, r *http.Request) (*Session, error) {
	cookie, err := r.Cookie("hypercut_session")
	if err != nil || len(cookie.Value) != 64 {
		return nil, nil
	}
	if _, err = hex.DecodeString(cookie.Value); err != nil {
		return nil, nil
	}
	session := &Session{}
	err = s.q.QueryRowContext(ctx, "SELECT sessions.id,owner,email,csrf,expires FROM sessions JOIN users ON users.id=sessions.owner WHERE sessions.id=? AND expires>?", hash([]byte(cookie.Value)), time.Now().UnixMilli()).Scan(&session.ID, &session.Owner, &session.Email, &session.CSRF, &session.Expires)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return session, err
}
