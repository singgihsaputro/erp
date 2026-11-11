import { Hono } from 'hono';
import {
  adjustmentInputSchema,
  adjustmentListQuerySchema,
  type AdjustmentDetail,
  type AdjustmentInput,
  type AdjustmentLine,
  type AdjustmentSummary,
  type Page,
} from '@erp/shared';
import type { Db } from './db.js';
import { requireRole } from './auth.js';
import { HttpError, parse, parseId, readJson, type AppEnv } from './http.js';
import { nextDocumentNumber } from './settings.js';
import { postStockMove } from './stock.js';

/** Who may post adjustments. Everyone signed in may read them. */
export const ADJUSTMENT_WRITERS = ['super_admin', 'owner', 'admin', 'warehouse'] as const;

const SUMMARY = `SELECT a.id, a.number, a.created_at, a.warehouse_id, w.name AS warehouse_name, a.reason, a.note,
    u.name AS created_by_name,
    (SELECT COUNT(*) FROM stock_adjustment_lines l WHERE l.adjustment_id = a.id) AS line_count,
    (SELECT COALESCE(SUM(CAST(ROUND(l.qty_milli * l.unit_cost / 1000.0) AS INTEGER)), 0) FROM stock_adjustment_lines l WHERE l.adjustment_id = a.id) AS value
  FROM stock_adjustments a JOIN warehouses w ON w.id = a.warehouse_id JOIN users u ON u.id = a.created_by`;

/** Validates and posts an adjustment: header, lines and ledger moves in one transaction. */
export function postAdjustment(db: Db, input: AdjustmentInput & { note?: string }, userId: number): number {
  const w = db.prepare('SELECT archived_at FROM warehouses WHERE id = ?').get(input.warehouse_id) as { archived_at: string | null } | undefined;
  if (!w) throw new HttpError(404, 'Warehouse not found');
  if (w.archived_at) throw new HttpError(409, 'Warehouse is archived');
  const seen = new Set<number>();
  for (const [i, l] of input.lines.entries()) {
    if (seen.has(l.product_id)) throw new HttpError(400, `Line ${i + 1}: product is listed twice`);
    seen.add(l.product_id);
    const p = db.prepare('SELECT name, archived_at FROM products WHERE id = ?').get(l.product_id) as { name: string; archived_at: string | null } | undefined;
    if (!p) throw new HttpError(404, `Line ${i + 1}: product not found`);
    if (p.archived_at) throw new HttpError(409, `Line ${i + 1}: product is archived`);
    if (l.qty_milli < 0) {
      const onHand = (db.prepare('SELECT COALESCE(SUM(qty_milli), 0) AS q FROM stock_moves WHERE product_id = ? AND warehouse_id = ?').get(l.product_id, input.warehouse_id) as { q: number }).q;
      if (onHand + l.qty_milli < 0) throw new HttpError(409, `Line ${i + 1}: only ${onHand / 1000} of ${p.name} on hand here, cannot remove ${-l.qty_milli / 1000}`);
    }
  }
  return db.transaction(() => {
    const number = nextDocumentNumber(db, 'stock_adjustment');
    const id = Number(
      db.prepare('INSERT INTO stock_adjustments (number, warehouse_id, reason, note, created_by) VALUES (?, ?, ?, ?, ?)')
        .run(number, input.warehouse_id, input.reason, input.note ?? '', userId).lastInsertRowid,
    );
    for (const l of input.lines) {
      const cost = (db.prepare('SELECT cost FROM products WHERE id = ?').get(l.product_id) as { cost: number }).cost;
      const unitCost = l.qty_milli > 0 ? (l.unit_cost ?? cost) : cost;
      postStockMove(db, {
        productId: l.product_id,
        warehouseId: input.warehouse_id,
        qtyMilli: l.qty_milli,
        unitCost,
        sourceType: 'stock_adjustment',
        sourceId: id,
        note: `${number} · ${input.reason}${input.note ? ` · ${input.note}` : ''}`,
      });
      db.prepare('INSERT INTO stock_adjustment_lines (adjustment_id, product_id, qty_milli, unit_cost) VALUES (?, ?, ?, ?)')
        .run(id, l.product_id, l.qty_milli, unitCost);
    }
    return id;
  })();
}

export function adjustmentRoutes(db: Db) {
  const app = new Hono<AppEnv>();

  app.get('/', (c) => {
    const q = parse(adjustmentListQuerySchema, c.req.query());
    const where = q.warehouse_id ? 'WHERE a.warehouse_id = ?' : '';
    const args = q.warehouse_id ? [q.warehouse_id] : [];
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM stock_adjustments a ${where}`).get(...args) as { n: number }).n;
    const items = db.prepare(`${SUMMARY} ${where} ORDER BY a.id DESC LIMIT ? OFFSET ?`).all(...args, q.page_size, (q.page - 1) * q.page_size) as AdjustmentSummary[];
    const body: Page<AdjustmentSummary> = { items, total, page: q.page, page_size: q.page_size };
    return c.json(body);
  });

  app.get('/:id', (c) => {
    const id = parseId(c.req.param('id'));
    const head = db.prepare(`${SUMMARY} WHERE a.id = ?`).get(id) as AdjustmentSummary | undefined;
    if (!head) throw new HttpError(404, 'Adjustment not found');
    const lines = db
      .prepare(
        `SELECT l.product_id, p.sku, p.name, p.base_unit, l.qty_milli, l.unit_cost
         FROM stock_adjustment_lines l JOIN products p ON p.id = l.product_id WHERE l.adjustment_id = ? ORDER BY l.id`,
      )
      .all(id) as AdjustmentLine[];
    const body: AdjustmentDetail = { ...head, lines };
    return c.json(body);
  });

  app.post('/', requireRole(...ADJUSTMENT_WRITERS) as never, async (c) => {
    const input = parse(adjustmentInputSchema, await readJson(c));
    const id = postAdjustment(db, input, c.get('user').id);
    const head = db.prepare(`${SUMMARY} WHERE a.id = ?`).get(id) as AdjustmentSummary;
    return c.json(head, 201);
  });

  return app;
}
