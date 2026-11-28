import { Hono } from 'hono';
import {
  promotionEvaluateQuerySchema, promotionInputSchema, promotionQuerySchema,
  type Page, type Promotion, type PromotionEvaluation, type PromotionInput, type PromotionOffer, type PromotionStatus,
} from '@erp/shared';
import type { Db } from './db.js';
import { requireRole } from './auth.js';
import { jakartaToday } from './batches.js';
import { HttpError, parse, parseId, readJson, type AppEnv } from './http.js';
import { PRICE_MANAGER_ROLES } from './price-lists.js';
import { SALES_ROLES } from './sales-orders.js';

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

type Row = Omit<Promotion, 'active' | 'status'> & { active: number };

const SELECT = `SELECT m.*, p.sku AS product_sku, p.name AS product_name, p.base_unit
  FROM promotions m JOIN products p ON p.id = m.product_id`;

function statusOf(r: Row, today: string): PromotionStatus {
  if (!r.active) return 'disabled';
  if (r.ends_on < today) return 'ended';
  return r.starts_on > today ? 'scheduled' : 'running';
}
const toPromotion = (r: Row, today: string): Promotion => ({ ...r, active: r.active === 1, status: statusOf(r, today) });

/** What one promotion takes off a line of `qtyMilli` at `unitPrice`; 0 when it does not apply. */
export function offerFor(r: Pick<Row, 'id' | 'name' | 'kind' | 'percent_off' | 'amount_off' | 'buy_qty_milli' | 'free_qty_milli' | 'min_qty_milli'>, qtyMilli: number, unitPrice: number): PromotionOffer {
  const lineTotal = Math.round((qtyMilli * unitPrice) / 1000);
  let discount = 0;
  let free = 0;
  if (r.kind === 'percent' && qtyMilli >= r.min_qty_milli) discount = Math.floor((lineTotal * (r.percent_off ?? 0)) / 100);
  else if (r.kind === 'fixed' && qtyMilli >= r.min_qty_milli) discount = Math.min(lineTotal, Math.round((qtyMilli * (r.amount_off ?? 0)) / 1000));
  else if (r.kind === 'buy_x_get_y') {
    const set = (r.buy_qty_milli ?? 0) + (r.free_qty_milli ?? 0);
    free = set > 0 ? Math.floor(qtyMilli / set) * (r.free_qty_milli ?? 0) : 0;
    discount = Math.round((free * unitPrice) / 1000);
  }
  return { promotion_id: r.id, name: r.name, kind: r.kind, discount, free_qty_milli: free };
}

/** Promotions running on `date` for a product, best discount first. Disabled ones never apply. */
export function evaluatePromotions(db: Db, productId: number, qtyMilli: number, unitPrice: number | undefined, date: string): PromotionEvaluation {
  const product = db.prepare('SELECT price FROM products WHERE id = ?').get(productId) as { price: number } | undefined;
  if (!product) throw new HttpError(404, 'Product not found');
  const price = unitPrice ?? product.price;
  const rows = db.prepare('SELECT * FROM promotions WHERE product_id = ? AND active = 1 AND starts_on <= ? AND ends_on >= ?').all(productId, date, date) as Row[];
  const offers = rows.map((r) => offerFor(r, qtyMilli, price)).filter((o) => o.discount > 0).sort((a, b) => b.discount - a.discount || a.promotion_id - b.promotion_id);
  const lineTotal = Math.round((qtyMilli * price) / 1000);
  const best = offers[0] ?? null;
  return { product_id: productId, qty_milli: qtyMilli, unit_price: price, date, line_total: lineTotal, best, offers, net_total: lineTotal - (best?.discount ?? 0) };
}

function checkProduct(db: Db, productId: number): void {
  const p = db.prepare('SELECT archived_at FROM products WHERE id = ?').get(productId) as { archived_at: string | null } | undefined;
  if (!p) throw new HttpError(404, 'Product not found');
  if (p.archived_at) throw new HttpError(409, 'Product is archived');
}

const columns = (v: ReturnType<typeof promotionInputSchema.parse>) => [
  v.name, v.kind, v.product_id,
  v.kind === 'percent' ? v.percent_off! : null,
  v.kind === 'fixed' ? v.amount_off! : null,
  v.kind === 'buy_x_get_y' ? v.buy_qty_milli! : null,
  v.kind === 'buy_x_get_y' ? v.free_qty_milli! : null,
  v.kind === 'buy_x_get_y' ? 1000 : v.min_qty_milli,
  v.starts_on, v.ends_on,
];

/** Creates a promotion; used by the route and the seed. */
export function createPromotion(db: Db, input: PromotionInput): number {
  const v = promotionInputSchema.parse(input);
  checkProduct(db, v.product_id);
  return Number(db.prepare(
    'INSERT INTO promotions (name, kind, product_id, percent_off, amount_off, buy_qty_milli, free_qty_milli, min_qty_milli, starts_on, ends_on) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(...columns(v)).lastInsertRowid);
}

export function promotionRoutes(db: Db) {
  const app = new Hono<AppEnv>();
  app.use('*', requireRole(...SALES_ROLES) as never);
  const manage = requireRole(...PRICE_MANAGER_ROLES) as never;
  const load = (id: number): Row | undefined => db.prepare(`${SELECT} WHERE m.id = ?`).get(id) as Row | undefined;

  app.get('/', (c) => {
    const q = parse(promotionQuerySchema, c.req.query());
    const today = jakartaToday();
    const like = `%${(q.q ?? '').replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    const conds = ["(m.name LIKE ? ESCAPE '\\' OR p.name LIKE ? ESCAPE '\\' OR p.sku LIKE ? ESCAPE '\\')"];
    const args: (string | number)[] = [like, like, like];
    if (q.status === 'disabled') conds.push('m.active = 0');
    else if (q.status) {
      conds.push('m.active = 1');
      if (q.status === 'ended') { conds.push('m.ends_on < ?'); args.push(today); }
      if (q.status === 'scheduled') { conds.push('m.starts_on > ?'); args.push(today); }
      if (q.status === 'running') { conds.push('m.starts_on <= ? AND m.ends_on >= ?'); args.push(today, today); }
    }
    const where = `WHERE ${conds.join(' AND ')}`;
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM promotions m JOIN products p ON p.id = m.product_id ${where}`).get(...args) as { n: number }).n;
    const rows = db.prepare(`${SELECT} ${where} ORDER BY m.starts_on DESC, m.id DESC LIMIT ? OFFSET ?`).all(...args, q.page_size, (q.page - 1) * q.page_size) as Row[];
    const body: Page<Promotion> = { items: rows.map((r) => toPromotion(r, today)), total, page: q.page, page_size: q.page_size };
    return c.json(body);
  });

  /** The discount a product and quantity would get on a business day. */
  app.get('/evaluate', (c) => {
    const q = parse(promotionEvaluateQuerySchema, c.req.query());
    return c.json(evaluatePromotions(db, q.product_id, q.qty_milli, q.unit_price, q.date ?? jakartaToday()));
  });

  app.get('/:id', (c) => {
    const r = load(parseId(c.req.param('id')));
    if (!r) throw new HttpError(404, 'Promotion not found');
    return c.json(toPromotion(r, jakartaToday()));
  });

  app.post('/', manage, async (c) => {
    const id = createPromotion(db, parse(promotionInputSchema, await readJson(c)) as PromotionInput);
    return c.json(toPromotion(load(id)!, jakartaToday()), 201);
  });

  app.put('/:id', manage, async (c) => {
    const id = parseId(c.req.param('id'));
    if (!load(id)) throw new HttpError(404, 'Promotion not found');
    const v = parse(promotionInputSchema, await readJson(c));
    checkProduct(db, v.product_id);
    db.prepare(`UPDATE promotions SET name = ?, kind = ?, product_id = ?, percent_off = ?, amount_off = ?, buy_qty_milli = ?, free_qty_milli = ?, min_qty_milli = ?, starts_on = ?, ends_on = ?, updated_at = ${NOW} WHERE id = ?`).run(...columns(v), id);
    return c.json(toPromotion(load(id)!, jakartaToday()));
  });

  /** Switches a promotion off or on without losing it. */
  for (const [path, active] of [['disable', 0], ['enable', 1]] as const) {
    app.post(`/:id/${path}`, manage, (c) => {
      const id = parseId(c.req.param('id'));
      if (db.prepare(`UPDATE promotions SET active = ?, updated_at = ${NOW} WHERE id = ?`).run(active, id).changes === 0) throw new HttpError(404, 'Promotion not found');
      return c.json(toPromotion(load(id)!, jakartaToday()));
    });
  }

  // Promotions are configuration; documents keep the price they were made with.
  app.delete('/:id', manage, (c) => {
    if (db.prepare('DELETE FROM promotions WHERE id = ?').run(parseId(c.req.param('id'))).changes === 0) throw new HttpError(404, 'Promotion not found');
    return c.body(null, 204);
  });

  return app;
}
