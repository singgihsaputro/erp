import { Hono } from 'hono';
import { userCreateSchema, userResetPasswordSchema, userUpdateSchema, type UserAccount } from '@erp/shared';
import type { Db } from './db.js';
import { hashPassword, requireRole } from './auth.js';
import { HttpError, parse, parseId, readJson, type AppEnv } from './http.js';

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
const COLS = 'id, username, name, role, disabled_at, last_login_at, created_at';

/** Only the super admin manages accounts. */
export function userRoutes(db: Db) {
  const app = new Hono<AppEnv>();
  app.use('*', requireRole('super_admin'));

  const find = (id: number) => db.prepare(`SELECT ${COLS} FROM users WHERE id = ?`).get(id) as UserAccount | undefined;
  const mustFind = (id: number) => {
    const u = find(id);
    if (!u) throw new HttpError(404, 'User not found');
    return u;
  };
  const otherActiveSuperAdmins = (id: number) =>
    (db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'super_admin' AND disabled_at IS NULL AND id != ?").get(id) as { n: number }).n;

  app.get('/', (c) => {
    const q = (c.req.query('q') ?? '').trim();
    const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
    const rows = db
      .prepare(`SELECT ${COLS} FROM users WHERE (? = '' OR username LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\') ORDER BY name COLLATE NOCASE`)
      .all(q, like, like);
    return c.json(rows);
  });

  app.get('/:id', (c) => c.json(mustFind(parseId(c.req.param('id')))));

  app.post('/', async (c) => {
    const input = parse(userCreateSchema, await readJson(c));
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(input.username)) {
      throw new HttpError(409, `Username ${input.username} is already taken`);
    }
    const r = db
      .prepare('INSERT INTO users (username, name, role, password_hash) VALUES (?, ?, ?, ?)')
      .run(input.username, input.name, input.role, hashPassword(input.password));
    return c.json(find(Number(r.lastInsertRowid)), 201);
  });

  app.put('/:id', async (c) => {
    const id = parseId(c.req.param('id'));
    const user = mustFind(id);
    const input = parse(userUpdateSchema, await readJson(c));
    if (user.role === 'super_admin' && input.role !== 'super_admin' && !user.disabled_at && otherActiveSuperAdmins(id) === 0) {
      throw new HttpError(409, 'There must be at least one active Super Admin');
    }
    db.prepare(`UPDATE users SET name = ?, role = ?, updated_at = ${NOW} WHERE id = ?`).run(input.name, input.role, id);
    return c.json(find(id));
  });

  app.post('/:id/reset-password', async (c) => {
    const id = parseId(c.req.param('id'));
    mustFind(id);
    const input = parse(userResetPasswordSchema, await readJson(c));
    db.prepare(`UPDATE users SET password_hash = ?, updated_at = ${NOW} WHERE id = ?`).run(hashPassword(input.new_password), id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id); // they must sign in again with the new one
    return c.json({ ok: true });
  });

  app.post('/:id/disable', (c) => {
    const id = parseId(c.req.param('id'));
    const user = mustFind(id);
    if (id === c.get('user').id) throw new HttpError(409, 'You cannot disable your own account');
    if (user.role === 'super_admin' && !user.disabled_at && otherActiveSuperAdmins(id) === 0) {
      throw new HttpError(409, 'There must be at least one active Super Admin');
    }
    db.prepare(`UPDATE users SET disabled_at = COALESCE(disabled_at, ${NOW}), updated_at = ${NOW} WHERE id = ?`).run(id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    return c.json(find(id));
  });

  app.post('/:id/enable', (c) => {
    const id = parseId(c.req.param('id'));
    mustFind(id);
    db.prepare(`UPDATE users SET disabled_at = NULL, updated_at = ${NOW} WHERE id = ?`).run(id);
    return c.json(find(id));
  });

  return app;
}
