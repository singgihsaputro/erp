import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { openDb } from '../src/db.js';
import { json, signIn, type Client } from './helpers.js';

let db: ReturnType<typeof openDb>;
let admin: Client;
const dewi = { username: 'dewi.kasir', name: 'Dewi Lestari', role: 'cashier', password: 'rahasia-123' };

beforeEach(async () => {
  db = openDb(':memory:');
  admin = await signIn(createApp(db));
});
const post = (path: string, body?: unknown) => admin.request(path, json('POST', body));
const create = async (body = dewi) => (await (await post('/api/users', body)).json()) as { id: number };

describe('user management API', () => {
  it('needs sign-in, and only the super admin may use it', async () => {
    expect((await createApp(db).request('/api/users')).status).toBe(401);
    await create();
    const cashier = await signIn(createApp(db), dewi.username, dewi.password);
    expect((await cashier.request('/api/users')).status).toBe(403);
    expect((await cashier.request('/api/users', json('POST', { ...dewi, username: 'x.y' }))).status).toBe(403);
    const { id } = (await (await admin.request('/api/users')).json())[0];
    expect((await cashier.request(`/api/users/${id}/disable`, json('POST'))).status).toBe(403);
  });

  it('creates an account that can sign in, without exposing the hash', async () => {
    const res = await post('/api/users', dewi);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ username: 'dewi.kasir', role: 'cashier', disabled_at: null });
    expect(JSON.stringify(body)).not.toContain('password');
    const me = await (await (await signIn(createApp(db), dewi.username, dewi.password)).request('/api/auth/me')).json();
    expect(me.name).toBe('Dewi Lestari');
    expect(await (await admin.request('/api/users?q=dewi')).json()).toHaveLength(1);
  });

  it('validates input and rejects duplicate usernames', async () => {
    expect((await post('/api/users', { ...dewi, password: 'short' })).status).toBe(400);
    expect((await post('/api/users', { ...dewi, role: 'boss' })).status).toBe(400);
    expect((await post('/api/users', { ...dewi, username: 'a b' })).status).toBe(400);
    await create();
    expect((await post('/api/users', { ...dewi, username: 'DEWI.kasir' })).status).toBe(409);
    expect((await admin.request('/api/users/999')).status).toBe(404);
  });

  it('edits name and role', async () => {
    const { id } = await create();
    const res = await admin.request(`/api/users/${id}`, json('PUT', { name: 'Dewi L.', role: 'warehouse' }));
    expect(await res.json()).toMatchObject({ name: 'Dewi L.', role: 'warehouse' });
    expect((await admin.request(`/api/users/${id}`, json('PUT', { name: '', role: 'cashier' }))).status).toBe(400);
  });

  it('resets a password and signs the user out everywhere', async () => {
    const { id } = await create();
    const session = await signIn(createApp(db), dewi.username, dewi.password);
    expect((await post(`/api/users/${id}/reset-password`, { new_password: 'x' })).status).toBe(400);
    expect((await post(`/api/users/${id}/reset-password`, { new_password: 'baru-12345' })).status).toBe(200);
    expect((await session.request('/api/auth/me')).status).toBe(401);
    await expect(signIn(createApp(db), dewi.username, dewi.password)).rejects.toThrow();
    await signIn(createApp(db), dewi.username, 'baru-12345');
  });

  it('disables and re-enables an account', async () => {
    const { id } = await create();
    const session = await signIn(createApp(db), dewi.username, dewi.password);
    const res = await post(`/api/users/${id}/disable`);
    expect((await res.json()).disabled_at).toBeTruthy();
    expect((await session.request('/api/auth/me')).status).toBe(401);
    await expect(signIn(createApp(db), dewi.username, dewi.password)).rejects.toThrow();
    expect((await (await post(`/api/users/${id}/enable`)).json()).disabled_at).toBeNull();
    await signIn(createApp(db), dewi.username, dewi.password);
  });

  it('never leaves the ERP without an active Super Admin', async () => {
    const me = (await (await admin.request('/api/auth/me')).json()) as { id: number };
    expect((await post(`/api/users/${me.id}/disable`)).status).toBe(409);
    expect((await admin.request(`/api/users/${me.id}`, json('PUT', { name: 'Admin', role: 'owner' }))).status).toBe(409);
    // with a second super admin, the first may step down
    await create({ ...dewi, role: 'super_admin' });
    expect((await admin.request(`/api/users/${me.id}`, json('PUT', { name: 'Admin', role: 'owner' }))).status).toBe(200);
  });
});
