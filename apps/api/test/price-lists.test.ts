import { beforeEach, describe, expect, it } from 'vitest';
import type { Page, PriceListProduct, PriceRule, QuotationDetail, ResolvedPrice, SalesOrderDetail } from '@erp/shared';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth.js';
import { openDb } from '../src/db.js';
import { json, signIn, type Client } from './helpers.js';

let db: ReturnType<typeof openDb>;
let app: Client;
let p: number;
let retail: number;
let grosir: number;
let wh: number;

const rule = (body: object, client: Client = app) => client.request('/api/price-lists/rules', json('PUT', body));
const resolve = async (customer: number, qty: number) =>
  (await (await app.request(`/api/price-lists/resolve?customer_id=${customer}&product_id=${p}&qty_milli=${qty}`)).json()) as ResolvedPrice;
async function as(role: string): Promise<Client> {
  db.prepare('INSERT INTO users (username, name, role, password_hash) VALUES (?, ?, ?, ?)').run(role, role, role, hashPassword('rahasia-1234'));
  return signIn(createApp(db), role, 'rahasia-1234');
}

beforeEach(async () => {
  db = openDb(':memory:');
  app = await signIn(createApp(db));
  p = Number(db.prepare("INSERT INTO products (sku, name, base_unit, cost, price) VALUES ('P1', 'Gula Pasir 1 kg', 'pcs', 10000, 20000)").run().lastInsertRowid);
  retail = Number(db.prepare("INSERT INTO customers (name, price_tier) VALUES ('Warung Eceran', 'retail')").run().lastInsertRowid);
  grosir = Number(db.prepare("INSERT INTO customers (name, price_tier) VALUES ('Toko Grosir', 'grosir')").run().lastInsertRowid);
  wh = (db.prepare("SELECT id FROM warehouses WHERE code = 'TOKO'").get() as { id: number }).id;
  db.prepare("INSERT INTO stock_moves (product_id, warehouse_id, qty_milli, unit_cost, source_type) VALUES (?, ?, 100000, 10000, 'opening')").run(p, wh);
});

describe('price lists API', () => {
  it('needs sign-in and a sales role, and only managers change prices', async () => {
    expect((await createApp(db).request('/api/price-lists')).status).toBe(401);
    expect((await (await as('warehouse')).request('/api/price-lists')).status).toBe(403);
    const cashier = await as('cashier');
    expect((await cashier.request('/api/price-lists')).status).toBe(200);
    expect((await rule({ product_id: p, tier: 'grosir', min_qty_milli: 10_000, price: 18_000 }, cashier)).status).toBe(403);
    expect((await cashier.request('/api/price-lists/rules/1', { method: 'DELETE' })).status).toBe(403);
  });

  it('adds a rule, changes it in place and lists it under its product', async () => {
    const created = await rule({ product_id: p, tier: 'grosir', min_qty_milli: 10_000, price: 18_000 });
    expect(created.status).toBe(201);
    const r = (await created.json()) as PriceRule;
    const again = await rule({ product_id: p, tier: 'grosir', min_qty_milli: 10_000, price: 17_500 });
    expect(again.status).toBe(200);
    expect(((await again.json()) as PriceRule).id).toBe(r.id);
    const list = (await (await app.request('/api/price-lists?q=gula')).json()) as Page<PriceListProduct>;
    expect(list.total).toBe(1);
    expect(list.items[0]).toMatchObject({ sku: 'P1', price: 20_000 });
    expect(list.items[0].rules).toEqual([{ id: r.id, product_id: p, tier: 'grosir', min_qty_milli: 10_000, price: 17_500 }]);
    expect(((await (await app.request('/api/price-lists?q=zzz')).json()) as Page<PriceListProduct>).items).toEqual([]);
  });

  it('rejects bad rules', async () => {
    expect((await rule({ product_id: p, tier: 'vip', price: 1 })).status).toBe(400);
    expect((await rule({ product_id: p, tier: 'grosir', price: -1 })).status).toBe(400);
    expect((await rule({ product_id: p, tier: 'grosir', price: 1.5 })).status).toBe(400);
    expect((await rule({ product_id: p, tier: 'grosir', min_qty_milli: 0, price: 1 })).status).toBe(400);
    expect((await rule({ product_id: 9999, tier: 'grosir', price: 1 })).status).toBe(404);
    db.prepare("UPDATE products SET archived_at = '2026-01-01' WHERE id = ?").run(p);
    expect((await rule({ product_id: p, tier: 'grosir', price: 1 })).status).toBe(409);
  });

  it('deletes a rule, 404 when it is gone', async () => {
    const r = (await (await rule({ product_id: p, tier: 'member', price: 19_000 })).json()) as PriceRule;
    expect((await app.request(`/api/price-lists/rules/${r.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await app.request(`/api/price-lists/rules/${r.id}`, { method: 'DELETE' })).status).toBe(404);
  });

  it('picks the best quantity break for the tier, then the retail break, then the normal price', async () => {
    await rule({ product_id: p, tier: 'grosir', min_qty_milli: 10_000, price: 18_000 });
    await rule({ product_id: p, tier: 'grosir', min_qty_milli: 50_000, price: 16_000 });
    await rule({ product_id: p, tier: 'retail', min_qty_milli: 20_000, price: 19_000 });
    expect(await resolve(grosir, 9_000)).toMatchObject({ unit_price: 20_000, source: 'base' });
    expect(await resolve(grosir, 10_000)).toMatchObject({ unit_price: 18_000, source: 'tier_rule', min_qty_milli: 10_000 });
    expect(await resolve(grosir, 49_999)).toMatchObject({ unit_price: 18_000 });
    expect(await resolve(grosir, 50_000)).toMatchObject({ unit_price: 16_000 });
    expect(await resolve(retail, 10_000)).toMatchObject({ unit_price: 20_000, source: 'base' });
    expect(await resolve(retail, 20_000)).toMatchObject({ unit_price: 19_000, source: 'tier_rule' });
    expect((await app.request(`/api/price-lists/resolve?customer_id=9999&product_id=${p}`)).status).toBe(404);
    expect((await app.request('/api/price-lists/resolve?product_id=1')).status).toBe(400);
  });

  it('prices order and quotation lines that have no price, and keeps explicit prices', async () => {
    await rule({ product_id: p, tier: 'grosir', min_qty_milli: 10_000, price: 18_000 });
    const so = async (qty: number, price?: number) =>
      (await (await app.request('/api/sales-orders', json('POST', { customer_id: grosir, warehouse_id: wh, lines: [{ product_id: p, qty_milli: qty, ...(price === undefined ? {} : { unit_price: price }) }] }))).json()) as SalesOrderDetail;
    expect((await so(5_000)).lines[0].unit_price).toBe(20_000);
    const big = await so(12_000);
    expect(big.lines[0]).toMatchObject({ unit_price: 18_000, amount: 216_000 });
    expect((await so(12_000, 17_000)).lines[0].unit_price).toBe(17_000);
    const q = (await (await app.request('/api/quotations', json('POST', { customer_id: grosir, warehouse_id: wh, lines: [{ product_id: p, qty_milli: 10_000 }] }))).json()) as QuotationDetail;
    expect(q.lines[0].unit_price).toBe(18_000);
    // editing the draft re-prices from the list
    const put = await app.request(`/api/quotations/${q.id}`, json('PUT', { customer_id: retail, warehouse_id: wh, lines: [{ product_id: p, qty_milli: 10_000 }] }));
    expect(((await put.json()) as QuotationDetail).lines[0].unit_price).toBe(20_000);
  });

  it('keeps the price on an existing order when the list changes later', async () => {
    await rule({ product_id: p, tier: 'grosir', min_qty_milli: 10_000, price: 18_000 });
    const o = (await (await app.request('/api/sales-orders', json('POST', { customer_id: grosir, warehouse_id: wh, lines: [{ product_id: p, qty_milli: 10_000 }] }))).json()) as SalesOrderDetail;
    await rule({ product_id: p, tier: 'grosir', min_qty_milli: 10_000, price: 15_000 });
    const after = (await (await app.request(`/api/sales-orders/${o.id}`)).json()) as SalesOrderDetail;
    expect(after.lines[0].unit_price).toBe(18_000);
  });
});
