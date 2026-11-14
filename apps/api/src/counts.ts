import { Hono } from 'hono';
import {
  countEntriesSchema,
  countInputSchema,
  countListQuerySchema,
  type CountDetail,
  type CountInput,
  type CountLine,
  type CountSummary,
  type Page,
} from '@erp/shared';
import type { Db } from './db.js';
import { requireRole } from './auth.js';
import { HttpError, parse, parseId, readJson, type AppEnv } from './http.js';
import { postAdjustment } from './adjustments.js';
import { nextDocumentNumber } from './settings.js';

/** Who may start, enter, post and cancel counts. Everyone signed in may read them. */
export const COUNT_WRITERS = ['super_admin', 'owner', 'admin', 'warehouse'] as const;

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

const SUMMARY = `SELECT c.id, c.number, c.created_at, c.status, c.warehouse_id, w.name AS warehouse_name, c.note,
    u.name AS created_by_name, c.posted_at, c.adjustment_id,
    (SELECT COUNT(*) FROM stock_count_lines l WHERE l.count_id = c.id) AS line_count,
    (SELECT COUNT(*) FROM stock_count_lines l WHERE l.count_id = c.id AND l.counted_qty_milli IS NOT NULL) AS counted_count,
    (SELECT COUNT(*) FROM stock_count_lines l WHERE l.count_id = c.id AND l.counted_qty_milli IS NOT NULL AND l.counted_qty_milli != l.system_qty_milli) AS variance_count,
    (SELECT COALESCE(SUM(CAST(ROUND((l.counted_qty_milli - l.system_qty_milli) * l.unit_cost / 1000.0) AS INTEGER)), 0)
       FROM stock_count_lines l WHERE l.count_id = c.id AND l.counted_qty_milli IS NOT NULL) AS variance_value
  FROM stock_counts c JOIN warehouses w ON w.id = c.warehouse_id JOIN users u ON u.id = c.created_by`;

interface Head { number: string; status: string; warehouse_id: number }

function loadHead(db: Db, id: number): Head {
  const h = db.prepare('SELECT number, status, warehouse_id FROM stock_counts WHERE id = ?').get(id) as Head | undefined;
  if (!h) throw new HttpError(404, 'Stock count not found');
  return h;
}

function requireDraft(h: Head): void {
  if (h.status !== 'draft') throw new HttpError(409, `Stock count ${h.number} is already ${h.status}`);
}

/** Starts a count: snapshots every active product with stock in the warehouse. */
export function startCount(db: Db, input: CountInput, userId: number): number {
  const w = db.prepare('SELECT archived_at FROM warehouses WHERE id = ?').get(input.warehouse_id) as { archived_at: string | null } | undefined;
  if (!w) throw new HttpError(404, 'Warehouse not found');
  if (w.archived_at) throw new HttpError(409, 'Warehouse is archived');
  const open = db.prepare("SELECT number FROM stock_counts WHERE warehouse_id = ? AND status = 'draft'").get(input.warehouse_id) as { number: string } | undefined;
  if (open) throw new HttpError(409, `Count ${open.number} is still open for this warehouse; post or cancel it first`);
  const rows = db
    .prepare(
      `SELECT p.id, p.cost, SUM(m.qty_milli) AS q FROM stock_moves m JOIN products p ON p.id = m.product_id
       WHERE m.warehouse_id = ? AND p.archived_at IS NULL GROUP BY p.id HAVING q != 0 ORDER BY p.name`,
    )
    .all(input.warehouse_id) as { id: number; cost: number; q: number }[];
  if (rows.length === 0) throw new HttpError(409, 'This warehouse holds no stock to count');
  return db.transaction(() => {
    const number = nextDocumentNumber(db, 'stock_opname');
    const id = Number(
      db.prepare('INSERT INTO stock_counts (number, warehouse_id, note, created_by) VALUES (?, ?, ?, ?)').run(number, input.warehouse_id, input.note ?? '', userId).lastInsertRowid,
    );
    const ins = db.prepare('INSERT INTO stock_count_lines (count_id, product_id, system_qty_milli, unit_cost) VALUES (?, ?, ?, ?)');
    for (const r of rows) ins.run(id, r.id, r.q, r.cost);
    return id;
  })();
}

export function enterCounts(db: Db, id: number, counts: { product_id: number; counted_qty_milli: number | null }[]): void {
  requireDraft(loadHead(db, id));
  const seen = new Set<number>();
  const upd = db.prepare(`UPDATE stock_count_lines SET counted_qty_milli = ?, updated_at = ${NOW} WHERE count_id = ? AND product_id = ?`);
  db.transaction(() => {
    for (const [i, c] of counts.entries()) {
      if (seen.has(c.product_id)) throw new HttpError(400, `Entry ${i + 1}: product is listed twice`);
      seen.add(c.product_id);
      if (upd.run(c.counted_qty_milli, id, c.product_id).changes === 0) throw new HttpError(404, `Entry ${i + 1}: product is not on this count sheet`);
    }
  })();
}

/** Posts the variances as one adjustment and freezes the count. Uncounted lines are left alone. */
export function postCount(db: Db, id: number, userId: number): void {
  const h = loadHead(db, id);
  requireDraft(h);
  const lines = db.prepare('SELECT product_id, system_qty_milli, counted_qty_milli FROM stock_count_lines WHERE count_id = ? ORDER BY id').all(id) as {
    product_id: number; system_qty_milli: number; counted_qty_milli: number | null;
  }[];
  const counted = lines.filter((l) => l.counted_qty_milli !== null);
  if (counted.length === 0) throw new HttpError(409, 'Enter at least one counted quantity before posting');
  const variances = counted
    .map((l) => ({ product_id: l.product_id, qty_milli: (l.counted_qty_milli as number) - l.system_qty_milli }))
    .filter((l) => l.qty_milli !== 0);
  db.transaction(() => {
    const adjustmentId = variances.length
      ? postAdjustment(db, { warehouse_id: h.warehouse_id, reason: 'correction', note: `Stock opname ${h.number}`, lines: variances }, userId)
      : null;
    db.prepare(`UPDATE stock_counts SET status = 'posted', posted_by = ?, posted_at = ${NOW}, adjustment_id = ?, updated_at = ${NOW} WHERE id = ?`).run(userId, adjustmentId, id);
  })();
}

export function countRoutes(db: Db) {
  const app = new Hono<AppEnv>();

  app.get('/', (c) => {
    const q = parse(countListQuerySchema, c.req.query());
    const conds: string[] = [];
    const args: unknown[] = [];
    if (q.status) { conds.push('c.status = ?'); args.push(q.status); }
    if (q.warehouse_id) { conds.push('c.warehouse_id = ?'); args.push(q.warehouse_id); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM stock_counts c ${where}`).get(...args) as { n: number }).n;
    const items = db.prepare(`${SUMMARY} ${where} ORDER BY c.id DESC LIMIT ? OFFSET ?`).all(...args, q.page_size, (q.page - 1) * q.page_size) as CountSummary[];
    const body: Page<CountSummary> = { items, total, page: q.page, page_size: q.page_size };
    return c.json(body);
  });

  const detail = (id: number): CountDetail => {
    const head = db.prepare(`${SUMMARY} WHERE c.id = ?`).get(id) as CountSummary | undefined;
    if (!head) throw new HttpError(404, 'Stock count not found');
    const raw = db
      .prepare(
        `SELECT l.product_id, p.sku, p.barcode, p.name, p.base_unit, l.system_qty_milli, l.counted_qty_milli, l.unit_cost
         FROM stock_count_lines l JOIN products p ON p.id = l.product_id WHERE l.count_id = ? ORDER BY p.name`,
      )
      .all(id) as Omit<CountLine, 'variance_milli' | 'variance_value'>[];
    const lines: CountLine[] = raw.map((l) => {
      const v = l.counted_qty_milli === null ? null : l.counted_qty_milli - l.system_qty_milli;
      return { ...l, variance_milli: v, variance_value: v === null ? null : Math.round((v * l.unit_cost) / 1000) };
    });
    return { ...head, lines };
  };

  app.get('/:id', (c) => c.json(detail(parseId(c.req.param('id')))));

  app.post('/', requireRole(...COUNT_WRITERS) as never, async (c) => {
    const input = parse(countInputSchema, await readJson(c));
    const id = startCount(db, input, c.get('user').id);
    return c.json(detail(id), 201);
  });

  app.put('/:id/counts', requireRole(...COUNT_WRITERS) as never, async (c) => {
    const id = parseId(c.req.param('id'));
    enterCounts(db, id, parse(countEntriesSchema, await readJson(c)).counts);
    return c.json(detail(id));
  });

  app.post('/:id/post', requireRole(...COUNT_WRITERS) as never, (c) => {
    const id = parseId(c.req.param('id'));
    postCount(db, id, c.get('user').id);
    return c.json(detail(id));
  });

  app.post('/:id/cancel', requireRole(...COUNT_WRITERS) as never, (c) => {
    const id = parseId(c.req.param('id'));
    requireDraft(loadHead(db, id));
    db.prepare(`UPDATE stock_counts SET status = 'cancelled', cancelled_at = ${NOW}, updated_at = ${NOW} WHERE id = ?`).run(id);
    return c.json(detail(id));
  });

  return app;
}
