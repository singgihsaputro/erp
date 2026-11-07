import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth.js';
import { openDb } from '../src/db.js';
import { seedDemo } from '../src/seed-data.js';
import { json, signIn, type Client } from './helpers.js';

let app: Client;
let db: ReturnType<typeof openDb>;
const pt = { name: 'CV Pelanggan Uji', phone: '021-777', npwp: '01.234.567.8-412.000', credit_limit: 5_000_000, payment_terms: 'net_14', price_tier: 'grosir' };

beforeEach(async () => {
  db = openDb(':memory:');
  app = await signIn(createApp(db));
});
const post = (path: string, body?: unknown) => app.request(path, json('POST', body));

describe('customers API', () => {
  it('requires sign-in, and only managers may change customers', async () => {
    expect((await createApp(db).request('/api/customers')).status).toBe(401);
    db.prepare("INSERT INTO users (username, name, role, password_hash) VALUES ('kasir', 'Kasir', 'cashier', ?)").run(hashPassword('kasir-123'));
    const staff = await signIn(createApp(db), 'kasir', 'kasir-123');
    expect((await staff.request('/api/customers')).status).toBe(200);
    expect((await staff.request('/api/customers', json('POST', pt))).status).toBe(403);
  });

  it('creates with defaults, fetches and edits', async () => {
    const res = await post('/api/customers', { name: '  Warung Kecil ' });
    expect(res.status).toBe(201);
    const c = await res.json();
    expect(c).toMatchObject({ name: 'Warung Kecil', credit_limit: 0, payment_terms: 'cash', price_tier: 'retail', archived_at: null });
    const put = await app.request(`/api/customers/${c.id}`, json('PUT', { ...pt, npwp: '012345678412000' }));
    expect(await put.json()).toMatchObject({ name: 'CV Pelanggan Uji', npwp: '01.234.567.8-412.000', credit_limit: 5_000_000, price_tier: 'grosir' });
    expect((await app.request('/api/customers/999')).status).toBe(404);
    expect((await app.request('/api/customers/abc')).status).toBe(400);
  });

  it('validates input', async () => {
    expect((await post('/api/customers', { ...pt, name: ' ' })).status).toBe(400);
    expect((await post('/api/customers', { ...pt, npwp: '123' })).status).toBe(400);
    expect((await post('/api/customers', { ...pt, price_tier: 'vip' })).status).toBe(400);
    expect((await post('/api/customers', { ...pt, credit_limit: -1 })).status).toBe(400);
    expect((await post('/api/customers', { ...pt, credit_limit: 1.5 })).status).toBe(400);
    expect((await post('/api/customers', { ...pt, email: 'bukan-email' })).status).toBe(400);
    expect((await app.request('/api/customers?tier=vip')).status).toBe(400);
  });

  it('rejects duplicate name or NPWP among active customers, but not after archiving', async () => {
    const a = await (await post('/api/customers', pt)).json();
    expect((await post('/api/customers', { ...pt, name: 'cv pelanggan uji', npwp: '' })).status).toBe(409);
    expect((await post('/api/customers', { ...pt, name: 'CV Lain' })).status).toBe(409);
    expect((await post(`/api/customers/${a.id}/archive`)).status).toBe(200);
    expect((await post('/api/customers', pt)).status).toBe(201);
    expect((await post(`/api/customers/${a.id}/restore`)).status).toBe(409);
  });

  it('archives, restores, searches and filters by price tier', async () => {
    const a = await (await post('/api/customers', pt)).json();
    await post('/api/customers', { name: 'Ibu Member', contact_person: 'Ibu Sari', price_tier: 'member' });
    const names = async (qs: string) => (await (await app.request(`/api/customers${qs}`)).json()).map((c: { name: string }) => c.name);
    expect(await names('')).toHaveLength(2);
    expect(await names('?tier=member')).toEqual(['Ibu Member']);
    expect(await names('?q=sari')).toEqual(['Ibu Member']);
    expect(await names('?q=%25')).toHaveLength(0);
    expect((await post(`/api/customers/${a.id}/archive`)).status).toBe(200);
    expect((await post(`/api/customers/${a.id}/archive`)).status).toBe(409);
    expect(await names('?archived=1')).toEqual(['CV Pelanggan Uji']);
    expect((await post(`/api/customers/${a.id}/restore`)).status).toBe(200);
    expect((await post(`/api/customers/${a.id}/restore`)).status).toBe(409);
  });

  it('seeds customers idempotently', async () => {
    seedDemo(db);
    seedDemo(db);
    const list = await (await app.request('/api/customers')).json();
    expect(list.map((c: { name: string }) => c.name)).toContain('CV Mitra Boga Nusantara');
    expect(new Set(list.map((c: { price_tier: string }) => c.price_tier))).toEqual(new Set(['retail', 'grosir', 'member']));
    expect(await (await app.request('/api/customers?archived=1')).json()).toHaveLength(1);
  });
});
