import crypto from 'node:crypto';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { changePasswordSchema, loginSchema, type Role, type SessionUser } from '@erp/shared';
import type { Db } from './db.js';
import { HttpError, parse, readJson, type AppEnv } from './http.js';

export const SESSION_COOKIE = 'erp_session';
const SESSION_DAYS = 7;
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

/** Created on first start, when there are no users at all. Change the password after signing in. */
export const BOOTSTRAP_ADMIN = { username: 'admin', password: 'superuser', name: 'Admin', role: 'super_admin' } as const;

// ---------------------------------------------------------------- passwords

const SCRYPT = { N: 16384, r: 8, p: 1 };

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, 64, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export function verifyPassword(password: string, stored: string): boolean {
  const [alg, n, r, p, salt, key] = stored.split('$');
  if (alg !== 'scrypt' || !salt || !key) return false;
  const expected = Buffer.from(key, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(salt, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return crypto.timingSafeEqual(actual, expected);
}

// Checked against when the username does not exist, so a wrong username takes
// as long as a wrong password and the response time gives nothing away.
let dummyHash: string | undefined;
const unknownUserHash = () => (dummyHash ??= hashPassword(crypto.randomBytes(16).toString('hex')));

// ---------------------------------------------------------------- users and sessions

interface UserRow extends SessionUser {
  password_hash: string;
  disabled_at: string | null;
}

/** On a database with no users, creates the super admin so there is always a way in. */
export function ensureBootstrapAdmin(db: Db): void {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
  if (n > 0) return;
  db.prepare('INSERT INTO users (username, name, role, password_hash) VALUES (?, ?, ?, ?)').run(
    BOOTSTRAP_ADMIN.username,
    BOOTSTRAP_ADMIN.name,
    BOOTSTRAP_ADMIN.role,
    hashPassword(BOOTSTRAP_ADMIN.password),
  );
}

const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

function createSession(db: Db, userId: number): string {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString();
  db.prepare(`DELETE FROM sessions WHERE expires_at <= ${NOW}`).run();
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(hashToken(token), userId, expires);
  return token;
}

function userForToken(db: Db, token: string): SessionUser | null {
  const row = db
    .prepare(
      `SELECT u.id, u.username, u.name, u.role FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ${NOW} AND u.disabled_at IS NULL`,
    )
    .get(hashToken(token)) as SessionUser | undefined;
  return row ?? null;
}

// ---------------------------------------------------------------- guards

/** Rejects the request with 401 unless it carries a live session; sets `c.get('user')`. */
export function requireSignIn(db: Db): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE);
    const user = token ? userForToken(db, token) : null;
    if (!user) throw new HttpError(401, 'Please sign in');
    c.set('user', user);
    await next();
  };
}

/** Use after requireSignIn. Rejects with 403 unless the user has one of the roles. */
export function requireRole(...roles: Role[]): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!roles.includes(c.get('user').role)) throw new HttpError(403, 'Your role does not allow this');
    await next();
  };
}

/** Five wrong passwords for a username lock it for fifteen minutes. In memory: a restart clears it. */
class LoginThrottle {
  private failures = new Map<string, number[]>();
  constructor(private max = 5, private windowMs = 15 * 60_000) {}

  private recent(key: string) {
    const cutoff = Date.now() - this.windowMs;
    const list = (this.failures.get(key) ?? []).filter((t) => t > cutoff);
    this.failures.set(key, list);
    return list;
  }
  check(key: string) {
    if (this.recent(key).length >= this.max) {
      throw new HttpError(429, 'Too many failed sign-ins for this username. Try again in 15 minutes.');
    }
  }
  fail(key: string) {
    this.recent(key).push(Date.now());
  }
  reset(key: string) {
    this.failures.delete(key);
  }
}

const isHttps = (c: Context) =>
  new URL(c.req.url).protocol === 'https:' || c.req.header('x-forwarded-proto') === 'https';

// ---------------------------------------------------------------- routes

export function authRoutes(db: Db) {
  const app = new Hono<AppEnv>();
  const throttle = new LoginThrottle();
  const signedIn = requireSignIn(db);

  app.post('/login', async (c) => {
    const input = parse(loginSchema, await readJson(c));
    const key = input.username.toLowerCase();
    throttle.check(key);
    const user = db
      .prepare('SELECT id, username, name, role, password_hash, disabled_at FROM users WHERE username = ?')
      .get(input.username) as UserRow | undefined;
    const ok = verifyPassword(input.password, user?.password_hash ?? unknownUserHash()) && !!user && !user.disabled_at;
    if (!ok || !user) {
      throttle.fail(key);
      throw new HttpError(401, 'Wrong username or password');
    }
    throttle.reset(key);
    const token = createSession(db, user.id);
    db.prepare(`UPDATE users SET last_login_at = ${NOW} WHERE id = ?`).run(user.id);
    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'Lax',
      path: '/',
      secure: isHttps(c),
      maxAge: SESSION_DAYS * 86_400,
    });
    const body: SessionUser = { id: user.id, username: user.username, name: user.name, role: user.role };
    return c.json(body);
  });

  app.post('/logout', (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  app.get('/me', signedIn, (c) => c.json(c.get('user')));

  app.post('/password', signedIn, async (c) => {
    const input = parse(changePasswordSchema, await readJson(c));
    const me = c.get('user');
    const { password_hash } = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(me.id) as UserRow;
    if (!verifyPassword(input.current_password, password_hash)) {
      throw new HttpError(400, 'Current password is wrong', {
        fieldErrors: { current_password: ['Current password is wrong'] },
      });
    }
    db.prepare(`UPDATE users SET password_hash = ?, updated_at = ${NOW} WHERE id = ?`).run(
      hashPassword(input.new_password),
      me.id,
    );
    // Sign out everywhere else; this browser stays signed in.
    const token = getCookie(c, SESSION_COOKIE) ?? '';
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(me.id, hashToken(token));
    return c.json({ ok: true });
  });

  return app;
}
