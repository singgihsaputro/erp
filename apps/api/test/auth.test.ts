import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { BOOTSTRAP_ADMIN, hashPassword, verifyPassword } from '../src/auth.js';
import { openDb, type Db } from '../src/db.js';
import { json, signIn } from './helpers.js';

let db: Db;
let app: ReturnType<typeof createApp>;

const login = (username: string, password: string) => app.request('/api/auth/login', json('POST', { username, password }));

beforeEach(() => {
  db = openDb(':memory:');
  app = createApp(db);
});

describe('sign-in', () => {
  it('creates the super admin admin / superuser on a fresh database', async () => {
    const res = await login('admin', 'superuser');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 1, username: 'admin', name: 'Admin', role: 'super_admin' });
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/^erp_session=[\w-]{40,};/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it('stores a salted scrypt hash, never the password', () => {
    const row = db.prepare('SELECT password_hash FROM users WHERE username = ?').get('admin') as { password_hash: string };
    expect(row.password_hash).toMatch(/^scrypt\$/);
    expect(row.password_hash).not.toContain(BOOTSTRAP_ADMIN.password);
    expect(hashPassword('x')).not.toBe(hashPassword('x'));
    expect(verifyPassword('superuser', row.password_hash)).toBe(true);
    expect(verifyPassword('Superuser', row.password_hash)).toBe(false);
  });

  it('answers a wrong password and an unknown user the same way', async () => {
    const wrong = await login('admin', 'nope');
    const unknown = await login('nobody', 'superuser');
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await wrong.json()).toEqual(await unknown.json());
    expect(wrong.headers.get('set-cookie')).toBeNull();
  });

  it('accepts the username in any case', async () => {
    expect((await login('ADMIN', 'superuser')).status).toBe(200);
  });

  it('rejects malformed sign-in requests with 400', async () => {
    expect((await app.request('/api/auth/login', json('POST', { username: '', password: 'x' }))).status).toBe(400);
    expect((await app.request('/api/auth/login', json('POST', { username: 'admin' }))).status).toBe(400);
    expect((await app.request('/api/auth/login', { method: 'POST', body: 'not json' })).status).toBe(400);
  });

  it('locks a username after five wrong passwords, even for the right one', async () => {
    for (let i = 0; i < 5; i++) expect((await login('admin', `wrong-${i}`)).status).toBe(401);
    expect((await login('admin', 'superuser')).status).toBe(429);
  });

  it('keeps health and sign-in open, and everything else behind it', async () => {
    expect((await app.request('/api/health')).status).toBe(200);
    expect((await app.request('/api/auth/me')).status).toBe(401);
    expect((await app.request('/api/products')).status).toBe(401);
    expect((await app.request('/api/invoice-extractions')).status).toBe(401);
    expect((await app.request('/api/products', { headers: { cookie: 'erp_session=forged' } })).status).toBe(401);
  });

  it('returns the signed-in user from /me', async () => {
    const me = await (await signIn(app)).request('/api/auth/me');
    expect(me.status).toBe(200);
    expect((await me.json()).role).toBe('super_admin');
  });

  it('signs out: the session stops working', async () => {
    const client = await signIn(app);
    const out = await client.request('/api/auth/logout', json('POST'));
    expect(out.status).toBe(200);
    expect(out.headers.get('set-cookie')).toMatch(/erp_session=;/);
    expect((await client.request('/api/auth/me')).status).toBe(401);
  });

  it('refuses an expired session', async () => {
    const client = await signIn(app);
    db.prepare("UPDATE sessions SET expires_at = '2000-01-01T00:00:00.000Z'").run();
    expect((await client.request('/api/auth/me')).status).toBe(401);
  });

  it('refuses a disabled user, even with a live session', async () => {
    const client = await signIn(app);
    db.prepare("UPDATE users SET disabled_at = '2026-01-01T00:00:00.000Z'").run();
    expect((await client.request('/api/auth/me')).status).toBe(401);
    expect((await login('admin', 'superuser')).status).toBe(401);
  });

  it('forbids a role without access with 403', async () => {
    db.prepare("INSERT INTO users (username, name, role, password_hash) VALUES ('kasir', 'Kasir Satu', 'cashier', ?)").run(
      hashPassword('kasir-123'),
    );
    const cashier = await signIn(app, 'kasir', 'kasir-123');
    expect((await cashier.request('/api/products')).status).toBe(200);
    expect((await cashier.request('/api/invoice-extractions')).status).toBe(403);
  });
});

describe('changing the password', () => {
  it('requires the current password, then signs out the other sessions', async () => {
    const here = await signIn(app);
    const elsewhere = await signIn(app);
    const change = (current_password: string, new_password: string) =>
      here.request('/api/auth/password', json('POST', { current_password, new_password }));

    const wrong = await change('not-it', 'a-new-password');
    expect(wrong.status).toBe(400);
    expect((await wrong.json()).details.fieldErrors.current_password).toBeDefined();
    expect((await change('superuser', 'short')).status).toBe(400);
    expect((await change('superuser', 'superuser')).status).toBe(400);

    expect((await change('superuser', 'a-new-password')).status).toBe(200);
    expect((await here.request('/api/auth/me')).status).toBe(200);
    expect((await elsewhere.request('/api/auth/me')).status).toBe(401);
    expect((await login('admin', 'superuser')).status).toBe(401);
    expect((await login('admin', 'a-new-password')).status).toBe(200);
  });

  it('is not undone by a restart: the bootstrap admin is only created on an empty database', async () => {
    const client = await signIn(app);
    await client.request('/api/auth/password', json('POST', { current_password: 'superuser', new_password: 'kept-after-restart' }));
    app = createApp(db); // what a server restart does
    expect((await login('admin', 'superuser')).status).toBe(401);
    expect((await login('admin', 'kept-after-restart')).status).toBe(200);
    expect((db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n).toBe(1);
  });
});
