import { Hono } from 'hono';
import { poInputSchema, poListQuerySchema, type Page, type PoDetail, type PoLine, type PoSummary } from '@erp/shared';
import type { Db } from './db.js';
import { requireRole } from './auth.js';
import { HttpError, parse, parseId, readJson, type AppEnv } from './http.js';
import { jakartaToday } from './batches.js';
import { getCompany, nextDocumentNumber } from './settings.js';

/** Who may raise, submit and cancel purchase orders (and who may read them). */
export const PO_WRITERS = ['super_admin', 'owner', 'admin', 'warehouse'] as const;
/** Who may approve a submitted order. */
export const PO_APPROVERS = ['super_admin', 'owner', 'admin'] as const;

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

/** SQL: quantity received so far for the order line aliased `a`. */
const RECEIVED = (a: string) =>
  `(SELECT COALESCE(SUM(gl.qty_milli), 0) FROM goods_receipt_lines gl JOIN goods_receipts g ON g.id = gl.receipt_id WHERE g.order_id = ${a}.order_id AND gl.product_id = ${a}.product_id)`;

const SUMMARY = `SELECT o.id, o.number, o.status, o.supplier_id, s.name AS supplier_name, o.warehouse_id, w.name AS warehouse_name,
    o.order_date, o.expected_date, o.note, u.name AS created_by_name, o.submitted_at, o.approved_at, a.name AS approved_by_name,
    o.cancelled_at, o.ppn_rate_bp,
    (SELECT COUNT(*) FROM purchase_order_lines l WHERE l.order_id = o.id) AS line_count,
    (SELECT COALESCE(SUM(MIN(l.qty_milli, ${RECEIVED('l')})), 0) FROM purchase_order_lines l WHERE l.order_id = o.id) AS received_total,
    (SELECT COALESCE(SUM(l.qty_milli), 0) FROM purchase_order_lines l WHERE l.order_id = o.id) AS ordered_total,
    (SELECT COALESCE(SUM(CAST(ROUND(l.qty_milli * l.unit_cost / 1000.0) AS INTEGER)), 0) FROM purchase_order_lines l WHERE l.order_id = o.id) AS dpp
  FROM purchase_orders o JOIN suppliers s ON s.id = o.supplier_id JOIN warehouses w ON w.id = o.warehouse_id
  JOIN users u ON u.id = o.created_by LEFT JOIN users a ON a.id = o.approved_by`;

type Row = Omit<PoSummary, 'ppn' | 'total' | 'receive_status'> & { received_total: number; ordered_total: number };
const withTax = (r: Row): PoSummary => {
  const { received_total, ordered_total, ...rest } = r;
  const ppn = Math.round((r.dpp * r.ppn_rate_bp) / 10_000);
  const receive_status = received_total <= 0 ? 'none' : received_total >= ordered_total ? 'complete' : 'partial';
  return { ...rest, receive_status, ppn, total: r.dpp + ppn };
};

type Input = ReturnType<typeof poInputSchema.parse>;

function validate(db: Db, input: Input): void {
  const s = db.prepare('SELECT archived_at FROM suppliers WHERE id = ?').get(input.supplier_id) as { archived_at: string | null } | undefined;
  if (!s) throw new HttpError(404, 'Supplier not found');
  if (s.archived_at) throw new HttpError(409, 'Supplier is archived');
  const w = db.prepare('SELECT archived_at FROM warehouses WHERE id = ?').get(input.warehouse_id) as { archived_at: string | null } | undefined;
  if (!w) throw new HttpError(404, 'Warehouse not found');
  if (w.archived_at) throw new HttpError(409, 'Warehouse is archived');
  const seen = new Set<number>();
  for (const [i, l] of input.lines.entries()) {
    if (seen.has(l.product_id)) throw new HttpError(400, `Line ${i + 1}: product is listed twice`);
    seen.add(l.product_id);
    const p = db.prepare('SELECT archived_at FROM products WHERE id = ?').get(l.product_id) as { archived_at: string | null } | undefined;
    if (!p) throw new HttpError(404, `Line ${i + 1}: product not found`);
    if (p.archived_at) throw new HttpError(409, `Line ${i + 1}: product is archived`);
  }
}

function writeLines(db: Db, id: number, input: Input): void {
  const add = db.prepare('INSERT INTO purchase_order_lines (order_id, product_id, qty_milli, unit_cost) VALUES (?, ?, ?, ?)');
  for (const l of input.lines) add.run(id, l.product_id, l.qty_milli, l.unit_cost);
}

/** Creates a draft purchase order. Also used by the demo seed. */
export function createPurchaseOrder(db: Db, input: Input, userId: number): number {
  validate(db, input);
  return db.transaction(() => {
    const number = nextDocumentNumber(db, 'purchase_order');
    const id = Number(
      db.prepare('INSERT INTO purchase_orders (number, supplier_id, warehouse_id, order_date, expected_date, note, ppn_rate_bp, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(number, input.supplier_id, input.warehouse_id, input.order_date ?? jakartaToday(), input.expected_date ?? null, input.note, getCompany(db).ppn_rate_bp, userId).lastInsertRowid,
    );
    writeLines(db, id, input);
    return id;
  })();
}

/** Moves an order to its next status; `from` is what it must be now. Also used by the demo seed. */
export function transitionPurchaseOrder(db: Db, id: number, action: 'submit' | 'approve' | 'reject' | 'cancel', userId: number): void {
  const o = db.prepare('SELECT number, status FROM purchase_orders WHERE id = ?').get(id) as { number: string; status: string } | undefined;
  if (!o) throw new HttpError(404, 'Purchase order not found');
  const rule = {
    submit: { from: ['draft'], set: `status = 'submitted', submitted_at = ${NOW}` },
    approve: { from: ['submitted'], set: `status = 'approved', approved_by = ${userId}, approved_at = ${NOW}` },
    reject: { from: ['submitted'], set: `status = 'draft', submitted_at = NULL` },
    cancel: { from: ['draft', 'submitted', 'approved'], set: `status = 'cancelled', cancelled_at = ${NOW}` },
  }[action];
  if (action === 'cancel' && db.prepare('SELECT 1 FROM goods_receipts WHERE order_id = ? LIMIT 1').get(id)) {
    throw new HttpError(409, `Purchase order ${o.number} already has goods received against it, so it cannot be cancelled`);
  }
  if (!rule.from.includes(o.status)) throw new HttpError(409, `Purchase order ${o.number} is ${o.status}, so it cannot be ${action === 'reject' ? 'sent back' : action === 'submit' ? 'submitted' : action === 'approve' ? 'approved' : 'cancelled'}`);
  db.prepare(`UPDATE purchase_orders SET ${rule.set}, updated_at = ${NOW} WHERE id = ?`).run(id);
}

export function purchaseOrderRoutes(db: Db) {
  const app = new Hono<AppEnv>();
  app.use('*', requireRole(...PO_WRITERS) as never);

  app.get('/', (c) => {
    const q = parse(poListQuerySchema, c.req.query());
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (q.status) { where.push('o.status = ?'); args.push(q.status); }
    if (q.supplier_id) { where.push('o.supplier_id = ?'); args.push(q.supplier_id); }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM purchase_orders o ${clause}`).get(...args) as { n: number }).n;
    const rows = db.prepare(`${SUMMARY} ${clause} ORDER BY o.id DESC LIMIT ? OFFSET ?`).all(...args, q.page_size, (q.page - 1) * q.page_size) as Row[];
    const body: Page<PoSummary> = { items: rows.map(withTax), total, page: q.page, page_size: q.page_size };
    return c.json(body);
  });

  const detail = (id: number): PoDetail => {
    const head = db.prepare(`${SUMMARY} WHERE o.id = ?`).get(id) as Row | undefined;
    if (!head) throw new HttpError(404, 'Purchase order not found');
    const sup = db.prepare('SELECT address, npwp FROM suppliers WHERE id = ?').get(head.supplier_id) as { address: string; npwp: string };
    const lines = db
      .prepare(
        `SELECT l.product_id, p.sku, p.name, p.base_unit, l.qty_milli, l.unit_cost,
           CAST(ROUND(l.qty_milli * l.unit_cost / 1000.0) AS INTEGER) AS amount, ${RECEIVED('l')} AS received_milli
         FROM purchase_order_lines l JOIN products p ON p.id = l.product_id WHERE l.order_id = ? ORDER BY l.id`,
      )
      .all(id) as PoLine[];
    return { ...withTax(head), supplier_address: sup.address, supplier_npwp: sup.npwp, lines };
  };

  app.get('/:id', (c) => c.json(detail(parseId(c.req.param('id')))));

  app.post('/', async (c) => {
    const input = parse(poInputSchema, await readJson(c));
    return c.json(detail(createPurchaseOrder(db, input, c.get('user').id)), 201);
  });

  // Only a draft can be edited; once submitted the order is read-only.
  app.put('/:id', async (c) => {
    const id = parseId(c.req.param('id'));
    const input = parse(poInputSchema, await readJson(c));
    const o = db.prepare('SELECT number, status, order_date FROM purchase_orders WHERE id = ?').get(id) as { number: string; status: string; order_date: string } | undefined;
    if (!o) throw new HttpError(404, 'Purchase order not found');
    if (o.status !== 'draft') throw new HttpError(409, `Purchase order ${o.number} is ${o.status}; only a draft can be edited`);
    validate(db, input);
    db.transaction(() => {
      db.prepare(`UPDATE purchase_orders SET supplier_id = ?, warehouse_id = ?, order_date = ?, expected_date = ?, note = ?, updated_at = ${NOW} WHERE id = ?`)
        .run(input.supplier_id, input.warehouse_id, input.order_date ?? o.order_date, input.expected_date ?? null, input.note, id);
      db.prepare('DELETE FROM purchase_order_lines WHERE order_id = ?').run(id);
      writeLines(db, id, input);
    })();
    return c.json(detail(id));
  });

  app.post('/:id/submit', (c) => {
    const id = parseId(c.req.param('id'));
    transitionPurchaseOrder(db, id, 'submit', c.get('user').id);
    return c.json(detail(id));
  });
  app.post('/:id/approve', requireRole(...PO_APPROVERS) as never, (c) => {
    const id = parseId(c.req.param('id'));
    transitionPurchaseOrder(db, id, 'approve', c.get('user').id);
    return c.json(detail(id));
  });
  app.post('/:id/reject', requireRole(...PO_APPROVERS) as never, (c) => {
    const id = parseId(c.req.param('id'));
    transitionPurchaseOrder(db, id, 'reject', c.get('user').id);
    return c.json(detail(id));
  });
  app.post('/:id/cancel', (c) => {
    const id = parseId(c.req.param('id'));
    transitionPurchaseOrder(db, id, 'cancel', c.get('user').id);
    return c.json(detail(id));
  });

  return app;
}
