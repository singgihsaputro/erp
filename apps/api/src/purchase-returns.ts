import { Hono } from 'hono';
import {
  prInputSchema,
  prListQuerySchema,
  type Page,
  type PrDetail,
  type PrLine,
  type PrReceiptOption,
  type PrSummary,
} from '@erp/shared';
import type { Db } from './db.js';
import { requireRole } from './auth.js';
import { HttpError, parse, parseId, readJson, type AppEnv } from './http.js';
import { jakartaToday } from './batches.js';
import { nextDocumentNumber } from './settings.js';
import { postStockMove } from './stock.js';
import { PO_WRITERS } from './purchase-orders.js';

type Input = ReturnType<typeof prInputSchema.parse>;

const qty = (milli: number) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 3 }).format(milli / 1000);

const SUMMARY = `SELECT r.id, r.number, r.receipt_id, g.number AS receipt_number, r.supplier_id, s.name AS supplier_name, w.name AS warehouse_name,
    i.number AS invoice_number, r.return_date, r.reason, r.dpp, r.ppn, r.total, r.credit_applied, r.total - r.credit_applied AS refund_due,
    (SELECT COUNT(*) FROM purchase_return_lines l WHERE l.return_id = r.id) AS line_count, r.created_at
  FROM purchase_returns r JOIN goods_receipts g ON g.id = r.receipt_id JOIN suppliers s ON s.id = r.supplier_id
  JOIN warehouses w ON w.id = r.warehouse_id LEFT JOIN supplier_invoices i ON i.id = r.invoice_id`;

/** Per product of a receipt: what came in, what already went back, and the price to credit (the invoice's if there is one). */
function returnableLines(db: Db, receiptId: number) {
  return db
    .prepare(
      `SELECT l.product_id, p.sku, p.name, p.base_unit, l.qty_milli AS received_milli,
         (SELECT COALESCE(SUM(rl.qty_milli), 0) FROM purchase_return_lines rl JOIN purchase_returns r ON r.id = rl.return_id
            WHERE r.receipt_id = l.receipt_id AND rl.product_id = l.product_id) AS returned_milli,
         COALESCE((SELECT il.unit_cost FROM supplier_invoice_lines il JOIN supplier_invoices i ON i.id = il.invoice_id
            WHERE i.receipt_id = l.receipt_id AND il.product_id = l.product_id), l.unit_cost) AS unit_cost
       FROM goods_receipt_lines l JOIN products p ON p.id = l.product_id WHERE l.receipt_id = ? ORDER BY l.id`,
    )
    .all(receiptId) as {
    product_id: number; sku: string; name: string; base_unit: string; received_milli: number; returned_milli: number; unit_cost: number;
  }[];
}

/**
 * Returns goods of a receipt to the supplier: stock goes out of the receipt's warehouse and the supplier invoice
 * (if any) is credited, which reduces what is owed. Also used by the demo seed.
 */
export function returnGoods(db: Db, input: Input, userId: number): number {
  const rc = db
    .prepare(
      `SELECT g.id, g.number, g.order_id, g.warehouse_id, g.receipt_date, o.supplier_id, o.ppn_rate_bp
       FROM goods_receipts g JOIN purchase_orders o ON o.id = g.order_id WHERE g.id = ?`,
    )
    .get(input.receipt_id) as { id: number; number: string; order_id: number; warehouse_id: number; receipt_date: string; supplier_id: number; ppn_rate_bp: number } | undefined;
  if (!rc) throw new HttpError(404, 'Goods receipt not found');
  const date = input.return_date ?? jakartaToday();
  if (date < rc.receipt_date) throw new HttpError(400, 'Return date cannot be before the receipt date');
  const avail = new Map(returnableLines(db, rc.id).map((l) => [l.product_id, l]));
  const seen = new Set<number>();
  const priced: { product_id: number; qty_milli: number; unit_cost: number }[] = [];
  for (const [i, l] of input.lines.entries()) {
    if (seen.has(l.product_id)) throw new HttpError(400, `Line ${i + 1}: product is listed twice`);
    seen.add(l.product_id);
    const a = avail.get(l.product_id);
    if (!a) throw new HttpError(404, `Line ${i + 1}: product is not on ${rc.number}`);
    const left = a.received_milli - a.returned_milli;
    if (l.qty_milli > left) throw new HttpError(409, `Line ${i + 1}: only ${qty(left)} of ${a.name} can still be returned from ${rc.number}, not ${qty(l.qty_milli)}`);
    const onHand = (db.prepare('SELECT COALESCE(SUM(qty_milli), 0) AS q FROM stock_moves WHERE product_id = ? AND warehouse_id = ?').get(l.product_id, rc.warehouse_id) as { q: number }).q;
    if (l.qty_milli > onHand) throw new HttpError(409, `Line ${i + 1}: only ${qty(onHand)} of ${a.name} is in stock in the warehouse, cannot return ${qty(l.qty_milli)}`);
    priced.push({ ...l, unit_cost: a.unit_cost });
  }
  const dpp = priced.reduce((s, l) => s + Math.round((l.qty_milli * l.unit_cost) / 1000), 0);
  const ppn = Math.round((dpp * rc.ppn_rate_bp) / 10_000);
  const total = dpp + ppn;
  return db.transaction(() => {
    const inv = db.prepare('SELECT id, total - amount_paid - amount_credited AS outstanding FROM supplier_invoices WHERE receipt_id = ?').get(rc.id) as
      | { id: number; outstanding: number }
      | undefined;
    const applied = inv ? Math.min(total, Math.max(0, inv.outstanding)) : 0;
    const number = nextDocumentNumber(db, 'purchase_return');
    const id = Number(
      db
        .prepare(
          `INSERT INTO purchase_returns (number, receipt_id, order_id, supplier_id, warehouse_id, invoice_id, return_date, reason, note, ppn_rate_bp, dpp, ppn, total, credit_applied, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(number, rc.id, rc.order_id, rc.supplier_id, rc.warehouse_id, inv?.id ?? null, date, input.reason, input.note, rc.ppn_rate_bp, dpp, ppn, total, applied, userId)
        .lastInsertRowid,
    );
    for (const l of priced) {
      db.prepare('INSERT INTO purchase_return_lines (return_id, product_id, qty_milli, unit_cost) VALUES (?, ?, ?, ?)').run(id, l.product_id, l.qty_milli, l.unit_cost);
      postStockMove(db, {
        productId: l.product_id, warehouseId: rc.warehouse_id, qtyMilli: -l.qty_milli, unitCost: l.unit_cost,
        sourceType: 'purchase_return', sourceId: id, note: `${number} · ${rc.number} · ${input.reason}`,
      });
    }
    if (inv && applied > 0) {
      db.prepare("UPDATE supplier_invoices SET amount_credited = amount_credited + ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(applied, inv.id);
    }
    return id;
  })();
}

export function purchaseReturnRoutes(db: Db) {
  const app = new Hono<AppEnv>();
  app.use('*', requireRole(...PO_WRITERS) as never);

  app.get('/', (c) => {
    const q = parse(prListQuerySchema, c.req.query());
    const where: string[] = [];
    const args: number[] = [];
    if (q.supplier_id) { where.push('r.supplier_id = ?'); args.push(q.supplier_id); }
    if (q.receipt_id) { where.push('r.receipt_id = ?'); args.push(q.receipt_id); }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM purchase_returns r ${clause}`).get(...args) as { n: number }).n;
    const items = db.prepare(`${SUMMARY} ${clause} ORDER BY r.id DESC LIMIT ? OFFSET ?`).all(...args, q.page_size, (q.page - 1) * q.page_size) as PrSummary[];
    const body: Page<PrSummary> = { items, total, page: q.page, page_size: q.page_size };
    return c.json(body);
  });

  /** Receipts that still have something to send back, with the returnable quantity per line. */
  app.get('/receipts', (c) => {
    const heads = db
      .prepare(
        `SELECT g.id, g.number, o.number AS order_number, s.name AS supplier_name, w.name AS warehouse_name, g.receipt_date, i.number AS invoice_number
         FROM goods_receipts g JOIN purchase_orders o ON o.id = g.order_id JOIN suppliers s ON s.id = o.supplier_id
         JOIN warehouses w ON w.id = g.warehouse_id LEFT JOIN supplier_invoices i ON i.receipt_id = g.id ORDER BY g.id DESC LIMIT 200`,
      )
      .all() as Omit<PrReceiptOption, 'lines'>[];
    const out: PrReceiptOption[] = [];
    for (const h of heads) {
      const lines = returnableLines(db, h.id).map((l) => ({
        product_id: l.product_id, sku: l.sku, name: l.name, base_unit: l.base_unit, received_milli: l.received_milli,
        returned_milli: l.returned_milli, returnable_milli: l.received_milli - l.returned_milli, unit_cost: l.unit_cost,
      }));
      if (lines.some((l) => l.returnable_milli > 0)) out.push({ ...h, lines });
    }
    return c.json(out);
  });

  const detail = (id: number): PrDetail => {
    const head = db.prepare(`${SUMMARY} WHERE r.id = ?`).get(id) as PrSummary | undefined;
    if (!head) throw new HttpError(404, 'Purchase return not found');
    const extra = db
      .prepare('SELECT r.note, r.ppn_rate_bp, u.name AS created_by_name FROM purchase_returns r JOIN users u ON u.id = r.created_by WHERE r.id = ?')
      .get(id) as Pick<PrDetail, 'note' | 'ppn_rate_bp' | 'created_by_name'>;
    const lines = db
      .prepare(
        `SELECT l.product_id, p.sku, p.name, p.base_unit, l.qty_milli, l.unit_cost,
           CAST(ROUND(l.qty_milli * l.unit_cost / 1000.0) AS INTEGER) AS amount
         FROM purchase_return_lines l JOIN products p ON p.id = l.product_id WHERE l.return_id = ? ORDER BY l.id`,
      )
      .all(id) as PrLine[];
    return { ...head, ...extra, lines };
  };

  app.get('/:id', (c) => c.json(detail(parseId(c.req.param('id')))));

  app.post('/', async (c) => {
    const input = parse(prInputSchema, await readJson(c));
    return c.json(detail(returnGoods(db, input, c.get('user').id)), 201);
  });

  return app;
}

