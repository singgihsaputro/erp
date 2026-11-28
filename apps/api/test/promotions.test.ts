import { beforeEach, describe, expect, it } from 'vitest';
import type { Page, Promotion, PromotionEvaluation } from '@erp/shared';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth.js';
import { openDb } from '../src/db.js';
import { json, signIn, type Client } from './helpers.js';

let db: ReturnType<typeof openDb>;
let app: Client;
let p: number;

const base = (extra: object) => ({ name: 'Promo', kind: 'percent', product_id: p, percent_off: 10, starts_on: '2026-11-01', ends_on: '2026-11-30', ...extra });
const create = (body: object, client: Client = app) => client.request('/api/promotions', json('POST', body));
const evaluate = async (qty: number, date: string, price = '') =>
  (await (await app.request(`/api/promotions/evaluate?product_id=${p}&qty_milli=${qty}&date=${date}${price}`)).json()) as PromotionEvaluation;
async function as(role: string): Promise<Client> {
  db.prepare('INSERT INTO users (username, name, role, password_hash) VALUES (?, ?, ?, ?)').run(role, role, role, hashPassword('rahasia-1234'));
  return signIn(createApp(db), role, 'rahasia-1234');
}

beforeEach(async () => {
  db = openDb(':memory:');
  app = await signIn(createApp(db));
  p = Number(db.prepare("INSERT INTO products (sku, name, base_unit, cost, price) VALUES ('P1', 'Gula Pasir 1 kg', 'pcs', 10000, 20000)").run().lastInsertRowid);
});

describe('promotions API', () => {
  it('needs sign-in and a sales role, and only managers change promotions', async () => {
    expect((await createApp(db).request('/api/promotions')).status).toBe(401);
    expect((await (await as('warehouse')).request('/api/promotions')).status).toBe(403);
    const cashier = await as('cashier');
    expect((await cashier.request('/api/promotions')).status).toBe(200);
    expect((await create(base({}), cashier)).status).toBe(403);
    expect((await cashier.request('/api/promotions/1', { method: 'DELETE' })).status).toBe(403);
    expect((await cashier.request('/api/promotions/1/disable', { method: 'POST' })).status).toBe(403);
  });

  it('creates, lists with status, edits, switches off and deletes', async () => {
    const res = await create(base({ name: 'Diskon Gula' }));
    expect(res.status).toBe(201);
    const made = (await res.json()) as Promotion;
    expect(made).toMatchObject({ name: 'Diskon Gula', kind: 'percent', percent_off: 10, product_name: 'Gula Pasir 1 kg', active: true });
    await create(base({ name: 'Lama', starts_on: '2020-01-01', ends_on: '2020-01-31' }));
    await create(base({ name: 'Nanti', starts_on: '2999-01-01', ends_on: '2999-01-31' }));
    const all = (await (await app.request('/api/promotions')).json()) as Page<Promotion>;
    expect(all.total).toBe(3);
    expect(all.items.find((x) => x.name === 'Lama')?.status).toBe('ended');
    expect(all.items.find((x) => x.name === 'Nanti')?.status).toBe('scheduled');
    const ended = (await (await app.request('/api/promotions?status=ended')).json()) as Page<Promotion>;
    expect(ended.items.map((x) => x.name)).toEqual(['Lama']);

    const put = await app.request(`/api/promotions/${made.id}`, json('PUT', base({ name: 'Diskon Gula 20%', percent_off: 20 })));
    expect(((await put.json()) as Promotion).percent_off).toBe(20);
    const off = (await (await app.request(`/api/promotions/${made.id}/disable`, { method: 'POST' })).json()) as Promotion;
    expect(off).toMatchObject({ active: false, status: 'disabled' });
    expect(((await (await app.request(`/api/promotions/${made.id}/enable`, { method: 'POST' })).json()) as Promotion).active).toBe(true);
    expect((await app.request(`/api/promotions/${made.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await app.request(`/api/promotions/${made.id}`)).status).toBe(404);
    expect((await app.request('/api/promotions/999/disable', { method: 'POST' })).status).toBe(404);
  });

  it('rejects invalid input', async () => {
    expect((await create(base({ name: '' }))).status).toBe(400);
    expect((await create(base({ percent_off: undefined }))).status).toBe(400);
    expect((await create(base({ percent_off: 101 }))).status).toBe(400);
    expect((await create(base({ kind: 'fixed', percent_off: undefined }))).status).toBe(400);
    expect((await create(base({ kind: 'buy_x_get_y', percent_off: undefined, buy_qty_milli: 5000 }))).status).toBe(400);
    expect((await create(base({ starts_on: '2026-12-01', ends_on: '2026-11-01' }))).status).toBe(400);
    expect((await create(base({ starts_on: '2026-02-31' }))).status).toBe(400);
    expect((await create(base({ product_id: 999 }))).status).toBe(404);
    db.prepare("UPDATE products SET archived_at = '2026-01-01' WHERE id = ?").run(p);
    expect((await create(base({}))).status).toBe(409);
    expect((await app.request('/api/promotions/evaluate?product_id=0')).status).toBe(400);
  });

  it('takes a percentage or a fixed amount off, only inside the dates and from the minimum quantity', async () => {
    await create(base({ percent_off: 10, min_qty_milli: 5000 }));
    expect((await evaluate(5000, '2026-11-15')).best).toMatchObject({ discount: 10_000 }); // 5 x 20.000 = 100.000, 10%
    expect((await evaluate(4000, '2026-11-15')).best).toBeNull();
    expect((await evaluate(5000, '2026-10-31')).best).toBeNull();
    expect((await evaluate(5000, '2026-11-01')).best).not.toBeNull();
    expect((await evaluate(5000, '2026-11-30')).best).not.toBeNull();
    expect((await evaluate(5000, '2026-12-01')).best).toBeNull();
    await create(base({ name: 'Potong', kind: 'fixed', percent_off: undefined, amount_off: 3000 }));
    const e = await evaluate(5000, '2026-11-15');
    expect(e.offers.map((o) => o.discount)).toEqual([15_000, 10_000]);
    expect(e).toMatchObject({ line_total: 100_000, net_total: 85_000 });
    expect(e.best?.name).toBe('Potong'); // the larger discount wins, they do not stack
  });

  it('gives buy X get Y free in whole sets and honours a given price', async () => {
    await create(base({ kind: 'buy_x_get_y', percent_off: undefined, buy_qty_milli: 5000, free_qty_milli: 1000 }));
    expect((await evaluate(5000, '2026-11-15')).best).toBeNull();
    const e = await evaluate(13_000, '2026-11-15', '&unit_price=10000'); // two sets of 6 → 2 free
    expect(e.best).toMatchObject({ free_qty_milli: 2000, discount: 20_000 });
    expect(e.net_total).toBe(110_000);
  });

  it('ignores switched-off promotions', async () => {
    const made = (await (await create(base({}))).json()) as Promotion;
    await app.request(`/api/promotions/${made.id}/disable`, { method: 'POST' });
    expect((await evaluate(5000, '2026-11-15')).best).toBeNull();
  });
});
