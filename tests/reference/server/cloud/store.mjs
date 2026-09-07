import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { randomUUID, randomBytes, scrypt as derive, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(derive);
export const digest = value => createHash('sha256').update(value).digest('hex');
export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function requireValue(condition, status, message) { if (!condition) throw new HttpError(status, message); }
export function openStore(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, 'cloud.sqlite');
  const db = new DatabaseSync(file, { timeout: 5000 });
  chmodSync(file, 0o600);
  if (db.prepare('PRAGMA user_version').get().user_version > 1) { db.close(); throw new Error('Database schema is newer than this HyperCut version.'); }
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, salt TEXT NOT NULL, hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES users(id), csrf TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, owner TEXT NOT NULL REFERENCES users(id), data TEXT NOT NULL, size INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1, created INTEGER NOT NULL, PRIMARY KEY(kind,id));
    CREATE INDEX IF NOT EXISTS records_owner ON records(owner,kind,created);
    CREATE INDEX IF NOT EXISTS session_expiry ON sessions(expires);
    PRAGMA user_version=1;`);
  const decode = row => row && ({ ...JSON.parse(row.data), id: row.id, owner: row.owner, version: row.version, createdAt: row.created });
  const store = {
    db, directory,
    get(kind, id, owner) { return decode(db.prepare('SELECT * FROM records WHERE kind=? AND id=? AND owner=?').get(kind, id, owner)); },
    need(kind, id, owner) { const result = this.get(kind, id, owner); requireValue(result && !result.deleting, 404, 'Record not found.'); return result; },
    list(kind, owner) { return db.prepare('SELECT * FROM records WHERE kind=? AND owner=? ORDER BY created DESC').all(kind, owner).map(decode); },
    all(kind) { return db.prepare('SELECT * FROM records WHERE kind=? ORDER BY created').all(kind).map(decode); },
    put(kind, item, size = 0) {
      db.prepare('INSERT INTO records(kind,id,owner,data,size,version,created) VALUES(?,?,?,?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data,size=excluded.size,version=excluded.version').run(kind, item.id, item.owner, JSON.stringify(item), size, item.version || 1, item.createdAt || Date.now());
      return this.get(kind, item.id, item.owner);
    },
    remove(kind, id, owner) { db.prepare('DELETE FROM records WHERE kind=? AND id=? AND owner=?').run(kind, id, owner); },
    usage(owner) { return db.prepare('SELECT coalesce(sum(size),0) AS bytes FROM records WHERE owner=?').get(owner).bytes; },
    transaction(fn) { db.exec('BEGIN IMMEDIATE'); try { const result = fn(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } },
    close() { db.close(); },
  };
  return store;
}
export async function createUser(store, email, password) {
  email = String(email).trim().toLowerCase();
  requireValue(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254, 400, 'Enter a valid email address.');
  requireValue(typeof password === 'string' && password.length >= 12 && password.length <= 256, 400, 'Use a password of 12–256 characters.');
  const salt = randomBytes(32).toString('hex');
  const hash = (await scrypt(password, salt, 64)).toString('hex');
  const id = randomUUID();
  store.db.prepare('INSERT INTO users VALUES(?,?,?,?)').run(id, email, salt, hash);
  return { id, email };
}
export async function authenticate(store, email, password) {
  requireValue(typeof email === 'string' && typeof password === 'string' && email.length <= 254 && password.length <= 256, 401, 'Invalid email or password.');
  const user = store.db.prepare('SELECT * FROM users WHERE email=?').get(email.trim().toLowerCase());
  const hash = await scrypt(password, user?.salt || 'hypercut-unknown-account', 64);
  requireValue(user && timingSafeEqual(hash, Buffer.from(user.hash, 'hex')), 401, 'Invalid email or password.');
  return { id: user.id, email: user.email };
}
export function createSession(store, owner) {
  const cookie = randomBytes(32).toString('hex'), csrf = randomBytes(32).toString('hex'), expires = Date.now() + 12 * 3600_000;
  const id = digest(cookie);
  store.db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());
  store.db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(id, owner, csrf, expires);
  return { cookie, csrf, expires, id };
}
export function sessionFor(store, cookies = '') {
  const cookie = cookies.split(';').map(x => x.trim()).find(x => x.startsWith('hypercut_session='))?.slice(17);
  if (!cookie || !/^[a-f0-9]{64}$/.test(cookie)) return null;
  return store.db.prepare('SELECT sessions.*, users.email FROM sessions JOIN users ON users.id=sessions.owner WHERE sessions.id=? AND expires>?').get(digest(cookie), Date.now());
}
