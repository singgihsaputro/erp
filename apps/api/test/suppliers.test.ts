import { beforeEach, describe, expect, it } from 'vitest';
import { normalizeNpwp } from '@erp/shared';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth.js';
import { openDb } from '../src/db.js';
import { seedDemo } from '../src/seed-data.js';
import { json, signIn, type Client } from './helpers.js';

let app: Client;
let db: ReturnType<typeof openDb>;
const pt = { name: 'PT Uji Coba', contact_person: 'Bu Dewi', phone: '021-555', npwp: '01.234.567.8-412.000', payment_terms: 'net_14' };

beforeEach(async () => {
  db = openDb(':memory:');
  app = await signIn(createApp(db));
});
const post = (path: string, body?: unknown) => app.request(path, json('POST', body));

describe('suppliers API', () => {
  it('requires sign-in, and only managers may change suppliers', async () => {
    expect((await createApp(db).request('/api/suppliers')).status).toBe(401);
    db.prepare("INSERT INTO users (username, name, role, password_hash) VALUES ('kasir', 'Kasir', 'cashier', ?)").run(hashPassword('kasir-123'));
    const staff = await signIn(createApp(db), 'kasir', 'kasir-123');
    expect((await staff.request('/api/suppliers')).status).toBe(200);
    expect((await staff.request('/api/suppliers', json('POST', pt))).status).toBe(403);
  });

  it('creates, fetches and edits a supplier, with defaults', async () => {
    const res = await post('/api/suppliers', { name: '  UD Kecil ' });
    expect(res.status).toBe(201);
    const s = await res.json();
    expect(s).toMatchObject({ name: 'UD Kecil', payment_terms: 'cash', npwp: '', archived_at: null });
    const put = await app.request(`/api/suppliers/${s.id}`, json('PUT', { ...pt, npwp: '012345678412000' }));
    expect(await put.json()).toMatchObject({ name: 'PT Uji Coba', npwp: '01.234.567.8-412.000', payment_terms: 'net_14' });
    expect((await (await app.request(`/api/suppliers/${s.id}`)).json()).contact_person).toBe('Bu Dewi');
    expect((await app.request('/api/suppliers/999')).status).toBe(404);
    expect((await app.request('/api/suppliers/abc')).status).toBe(400);
  });

  it('validates input', async () => {
    expect((await post('/api/suppliers', { ...pt, name: ' ' })).status).toBe(400);
    expect((await post('/api/suppliers', { ...pt, npwp: '123' })).status).toBe(400);
    expect((await post('/api/suppliers', { ...pt, payment_terms: 'net_90' })).status).toBe(400);
    expect((await post('/api/suppliers', { ...pt, email: 'bukan-email' })).status).toBe(400);
    expect(normalizeNpwp('0023 4567 8901 5000')).toBe('0023456789015000');
  });

  it('rejects a duplicate name or NPWP among active suppliers, but not after archiving', async () => {
    const a = await (await post('/api/suppliers', pt)).json();
    expect((await post('/api/suppliers', { ...pt, name: 'pt uji coba', npwp: '' })).status).toBe(409);
    expect((await post('/api/suppliers', { ...pt, name: 'PT Lain' })).status).toBe(409);
    expect((await post(`/api/suppliers/${a.id}/archive`)).status).toBe(200);
    const b = await post('/api/suppliers', pt);
    expect(b.status).toBe(201);
    // restoring would now collide with the active one
    expect((await post(`/api/suppliers/${a.id}/restore`)).status).toBe(409);
  });

  it('archives, restores and filters', async () => {
    const a = await (await post('/api/suppliers', pt)).json();
    await post('/api/suppliers', { name: 'CV Lain', contact_person: 'Pak Budi' });
    expect(await (await app.request('/api/suppliers')).json()).toHaveLength(2);
    expect((await post(`/api/suppliers/${a.id}/archive`)).status).toBe(200);
    expect((await post(`/api/suppliers/${a.id}/archive`)).status).toBe(409);
    expect(await (await app.request('/api/suppliers')).json()).toHaveLength(1);
    expect(await (await app.request('/api/suppliers?archived=1')).json()).toHaveLength(1);
    expect((await post(`/api/suppliers/${a.id}/restore`)).status).toBe(200);
    expect((await post(`/api/suppliers/${a.id}/restore`)).status).toBe(409);
    const found = await (await app.request('/api/suppliers?q=budi')).json();
    expect(found.map((s: { name: string }) => s.name)).toEqual(['CV Lain']);
    expect(await (await app.request('/api/suppliers?q=%25')).json()).toHaveLength(0);
  });

  it('seeds suppliers idempotently', async () => {
    seedDemo(db);
    seedDemo(db);
    const list = await (await app.request('/api/suppliers')).json();
    expect(list.map((s: { name: string }) => s.name)).toContain('PT Sumber Pangan Lestari');
    expect(await (await app.request('/api/suppliers?archived=1')).json()).toHaveLength(1);
  });
});
