import { Hono } from 'hono';
import {
  batchListQuerySchema,
  batchPickQuerySchema,
  batchReceiptSchema,
  type BatchList,
  type BatchPick,
  type BatchRow,
} from '@erp/shared';
import type { Db } from './db.js';
import { requireRole } from './auth.js';
import { HttpError, parse, readJson } from './http.js';
import { postStockMove, STOCK_WRITERS } from './stock.js';

const DAY = 86_400_000;

/** Today in Asia/Jakarta as YYYY-MM-DD. */
export function jakartaToday(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);

interface Raw extends Omit<BatchRow, 'days_left' | 'status'> {}

const SELECT = `SELECT b.id AS batch_id, b.product_id, p.sku, p.name, p.base_unit, b.batch_no, b.expiry_date,
    m.warehouse_id, w.name AS warehouse_name, SUM(m.qty_milli) AS qty_milli
  FROM stock_moves m JOIN stock_batches b ON b.id = m.batch_id JOIN products p ON p.id = b.product_id JOIN warehouses w ON w.id = m.warehouse_id`;

function shape(r: Raw, today: string, soonDays: number): BatchRow {
  if (!r.expiry_date) return { ...r, days_left: null, status: 'none' };
  const days = daysBetween(today, r.expiry_date);
  return { ...r, days_left: days, status: days < 0 ? 'expired' : days <= soonDays ? 'soon' : 'ok' };
}

export function batchRoutes(db: Db) {
  const app = new Hono();

  /** Batches with stock, soonest expiry first (first-expired-first-out), undated batches last. */
  app.get('/', (c) => {
    const q = parse(batchListQuerySchema, c.req.query());
    const today = jakartaToday();
    const where = ['1 = 1'];
    const args: (string | number)[] = [];
    if (q.q) {
      where.push('(p.name LIKE ? OR p.sku LIKE ? OR b.batch_no LIKE ?)');
      const like = `%${q.q}%`;
      args.push(like, like, like);
    }
    if (q.product_id) { where.push('b.product_id = ?'); args.push(q.product_id); }
    if (q.warehouse_id) { where.push('m.warehouse_id = ?'); args.push(q.warehouse_id); }
    // Batches are few (one per lot in a warehouse), so classify and filter on the shaped rows.
    const all = (
      db.prepare(`${SELECT} WHERE ${where.join(' AND ')} GROUP BY m.batch_id, m.warehouse_id HAVING SUM(m.qty_milli) > 0
        ORDER BY b.expiry_date IS NULL, b.expiry_date, p.name COLLATE NOCASE, b.batch_no`).all(...args) as Raw[]
    ).map((r) => shape(r, today, q.days));
    const rows = q.filter === 'all' ? all : all.filter((r) => (q.filter === 'expired' ? r.status === 'expired' : r.status === 'soon'));
    const body: BatchList = {
      items: rows.slice((q.page - 1) * q.page_size, q.page * q.page_size),
      total: rows.length,
      page: q.page,
      page_size: q.page_size,
      expired_count: all.filter((r) => r.status === 'expired').length,
      soon_count: all.filter((r) => r.status === 'soon').length,
      today,
    };
    return c.json(body);
  });

  /** Which batches to take from, first-expired-first-out. Expired batches are never suggested. */
  app.get('/pick', (c) => {
    const q = parse(batchPickQuerySchema, c.req.query());
    const today = jakartaToday();
    const rows = db
      .prepare(`${SELECT} WHERE b.product_id = ? AND m.warehouse_id = ? GROUP BY m.batch_id HAVING SUM(m.qty_milli) > 0
        ORDER BY b.expiry_date IS NULL, b.expiry_date, b.id`)
      .all(q.product_id, q.warehouse_id) as Raw[];
    let left = q.qty_milli;
    let expired = 0;
    const allocations: BatchPick['allocations'] = [];
    for (const r of rows) {
      if (r.expiry_date && r.expiry_date < today) { expired += r.qty_milli; continue; }
      if (left <= 0) continue;
      const take = Math.min(left, r.qty_milli);
      allocations.push({ batch_id: r.batch_id, batch_no: r.batch_no, expiry_date: r.expiry_date, qty_milli: take });
      left -= take;
    }
    const body: BatchPick = { allocations, shortfall_milli: left, expired_milli: expired };
    return c.json(body);
  });

  /** Receives stock into a batch (new, or more of an existing one). */
  app.post('/', requireRole(...STOCK_WRITERS) as never, async (c) => {
    const input = parse(batchReceiptSchema, await readJson(c));
    const p = db.prepare('SELECT archived_at FROM products WHERE id = ?').get(input.product_id) as { archived_at: string | null } | undefined;
    if (!p) throw new HttpError(404, 'Product not found');
    if (p.archived_at) throw new HttpError(409, 'Product is archived');
    const w = db.prepare('SELECT archived_at FROM warehouses WHERE id = ?').get(input.warehouse_id) as { archived_at: string | null } | undefined;
    if (!w) throw new HttpError(404, 'Warehouse not found');
    if (w.archived_at) throw new HttpError(409, 'Warehouse is archived');
    const expiry = input.expiry_date ?? null;
    const batchId = db.transaction(() => {
      const existing = db.prepare('SELECT id, expiry_date FROM stock_batches WHERE product_id = ? AND batch_no = ?').get(input.product_id, input.batch_no) as
        | { id: number; expiry_date: string | null }
        | undefined;
      if (existing && existing.expiry_date !== expiry) {
        throw new HttpError(409, `Batch ${input.batch_no} already exists with expiry ${existing.expiry_date ?? 'none'}; a batch has one expiry date`);
      }
      const id = existing?.id ?? Number(db.prepare('INSERT INTO stock_batches (product_id, batch_no, expiry_date) VALUES (?, ?, ?)').run(input.product_id, input.batch_no, expiry).lastInsertRowid);
      postStockMove(db, {
        productId: input.product_id,
        warehouseId: input.warehouse_id,
        qtyMilli: input.qty_milli,
        unitCost: input.unit_cost,
        sourceType: 'batch_receipt',
        sourceId: id,
        note: `Batch ${input.batch_no}`,
        batchId: id,
      });
      return id;
    })();
    const row = db.prepare(`${SELECT} WHERE b.id = ? AND m.warehouse_id = ? GROUP BY m.batch_id`).get(batchId, input.warehouse_id) as Raw;
    return c.json(shape(row, jakartaToday(), 30), 201);
  });

  return app;
}
