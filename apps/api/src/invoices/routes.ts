import crypto from 'node:crypto';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import {
  checkInvoice,
  invoiceDataSchema,
  invoiceListQuerySchema,
  rejectInvoiceSchema,
  type FoundFields,
  type InvoiceData,
  type InvoiceExtraction,
  type InvoiceExtractionSummary,
  type InvoiceStatus,
  type Page,
} from '@erp/shared';
import { requireRole } from '../auth.js';
import type { Db } from '../db.js';
import { HttpError, parse, parseId, readJson, type AppEnv } from '../http.js';
import { matchProducts } from './match.js';
import { parseInvoice } from './parse.js';
import { linesToText, readPdfText } from './pdf-text.js';

export const MAX_PDF_BYTES = 10 * 1024 * 1024;
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

interface Row {
  id: number;
  file_name: string;
  file_size: number;
  page_count: number;
  raw_text: string;
  status: InvoiceStatus;
  extracted_json: string;
  found_json: string;
  data_json: string;
  supplier_name: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  total: number | null;
  rejected_reason: string | null;
  uploaded_by_name: string;
  decided_by_name: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
}

const SELECT = `SELECT e.id, e.file_name, e.file_size, e.page_count, e.raw_text, e.status, e.extracted_json, e.found_json,
  e.data_json, e.supplier_name, e.invoice_number, e.invoice_date, e.total, e.rejected_reason, e.decided_at,
  e.created_at, e.updated_at, u.name AS uploaded_by_name, d.name AS decided_by_name
  FROM invoice_extractions e JOIN users u ON u.id = e.uploaded_by LEFT JOIN users d ON d.id = e.decided_by`;

/**
 * Reads a PDF, extracts the invoice, suggests products for its lines and files
 * it in the inbox for review. Shared by the upload endpoint and the seed.
 */
export async function ingestInvoicePdf(db: Db, input: { fileName: string; bytes: Uint8Array; userId: number }): Promise<number> {
  const sha = crypto.createHash('sha256').update(input.bytes).digest('hex');
  const same = db.prepare('SELECT id FROM invoice_extractions WHERE file_sha256 = ?').get(sha) as { id: number } | undefined;
  if (same) throw new HttpError(409, `This file is already in the inbox as #${same.id}.`, { id: same.id });

  const pdf = await readPdfText(input.bytes);
  if (pdf.lines.length === 0) {
    throw new HttpError(422, 'This PDF has no text layer — it looks like a scan. Scanned invoices need OCR, which is not supported yet.');
  }
  const parsed = parseInvoice(pdf.lines);
  const matches = matchProducts(
    db,
    parsed.data.lines.map((l, i) => ({ description: l.description, text: parsed.rowTexts[i] ?? l.description })),
  );
  const data: InvoiceData = { ...parsed.data, lines: parsed.data.lines.map((l, i) => ({ ...l, product_id: matches[i] })) };
  const json = JSON.stringify(data);
  const r = db
    .prepare(
      `INSERT INTO invoice_extractions (file_name, file_size, file_sha256, file_data, page_count, raw_text, extracted_json,
         found_json, data_json, supplier_name, invoice_number, invoice_date, total, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.fileName,
      input.bytes.byteLength,
      sha,
      Buffer.from(input.bytes),
      pdf.pageCount,
      linesToText(pdf.lines),
      json,
      JSON.stringify(parsed.found),
      json,
      data.supplier_name,
      data.invoice_number,
      data.invoice_date,
      data.total,
      input.userId,
    );
  return Number(r.lastInsertRowid);
}

export function invoiceRoutes(db: Db) {
  const app = new Hono<AppEnv>();
  app.use('*', requireRole('super_admin', 'owner', 'admin'));

  const load = (id: number) => {
    const row = db.prepare(`${SELECT} WHERE e.id = ?`).get(id) as Row | undefined;
    if (!row) throw new HttpError(404, 'Invoice not found');
    return row;
  };
  const mustBeInReview = (row: Row) => {
    if (row.status !== 'review') throw new HttpError(409, `This invoice is already ${row.status}.`);
  };

  const summary = (row: Row): InvoiceExtractionSummary => {
    const issues = checkInvoice(JSON.parse(row.data_json));
    return {
      id: row.id,
      file_name: row.file_name,
      status: row.status,
      supplier_name: row.supplier_name,
      invoice_number: row.invoice_number,
      invoice_date: row.invoice_date,
      total: row.total,
      errors: issues.filter((i) => i.level === 'error').length,
      warnings: issues.filter((i) => i.level === 'warning').length,
      uploaded_by_name: row.uploaded_by_name,
      created_at: row.created_at,
    };
  };

  const detail = (row: Row): InvoiceExtraction => {
    const data = JSON.parse(row.data_json) as InvoiceData;
    const dup = data.invoice_number
      ? (db
          .prepare(
            `SELECT id, status FROM invoice_extractions WHERE id != ? AND status != 'rejected'
             AND invoice_number = ? COLLATE NOCASE AND IFNULL(supplier_name, '') = IFNULL(?, '') COLLATE NOCASE
             ORDER BY id LIMIT 1`,
          )
          .get(row.id, data.invoice_number, data.supplier_name) as { id: number; status: InvoiceStatus } | undefined)
      : undefined;
    return {
      ...summary(row),
      page_count: row.page_count,
      file_size: row.file_size,
      data,
      extracted: JSON.parse(row.extracted_json),
      found: JSON.parse(row.found_json) as FoundFields,
      issues: checkInvoice(data),
      raw_text: row.raw_text,
      rejected_reason: row.rejected_reason,
      decided_by_name: row.decided_by_name,
      decided_at: row.decided_at,
      duplicate_of: dup ?? null,
      updated_at: row.updated_at,
    };
  };

  app.get('/', (c) => {
    const q = parse(invoiceListQuerySchema, c.req.query());
    const where: string[] = [];
    const params: unknown[] = [];
    if (q.status !== 'all') {
      where.push('e.status = ?');
      params.push(q.status);
    }
    if (q.q) {
      const like = `%${q.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
      where.push("(e.supplier_name LIKE ? ESCAPE '\\' OR e.invoice_number LIKE ? ESCAPE '\\' OR e.file_name LIKE ? ESCAPE '\\')");
      params.push(like, like, like);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM invoice_extractions e ${clause}`).get(...params) as { n: number }).n;
    const rows = db
      .prepare(`${SELECT} ${clause} ORDER BY e.created_at DESC, e.id DESC LIMIT ? OFFSET ?`)
      .all(...params, q.page_size, (q.page - 1) * q.page_size) as Row[];
    const body: Page<InvoiceExtractionSummary> = { items: rows.map(summary), total, page: q.page, page_size: q.page_size };
    return c.json(body);
  });

  app.post(
    '/',
    bodyLimit({
      maxSize: MAX_PDF_BYTES + 64 * 1024,
      onError: () => {
        throw new HttpError(413, 'The PDF is larger than 10 MB.');
      },
    }),
    async (c) => {
      const body = await c.req.parseBody().catch(() => {
        throw new HttpError(400, 'Send the PDF as multipart/form-data in a field named "file".');
      });
      const file = body.file;
      if (!(file instanceof File)) throw new HttpError(400, 'Send the PDF as multipart/form-data in a field named "file".');
      if (file.size > MAX_PDF_BYTES) throw new HttpError(413, 'The PDF is larger than 10 MB.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.byteLength === 0 || Buffer.from(bytes.subarray(0, 5)).toString('latin1') !== '%PDF-') {
        throw new HttpError(415, 'Only PDF files can be read.');
      }
      const name = (file.name || 'invoice.pdf').replace(/[\\/]/g, '_').slice(0, 200);
      const id = await ingestInvoicePdf(db, { fileName: name, bytes, userId: c.get('user').id });
      return c.json(detail(load(id)), 201);
    },
  );

  app.get('/:id', (c) => c.json(detail(load(parseId(c.req.param('id'))))));

  app.get('/:id/file', (c) => {
    const id = parseId(c.req.param('id'));
    const row = db.prepare('SELECT file_name, file_data FROM invoice_extractions WHERE id = ?').get(id) as
      | { file_name: string; file_data: Buffer }
      | undefined;
    if (!row) throw new HttpError(404, 'Invoice not found');
    return c.body(new Uint8Array(row.file_data), 200, {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(row.file_name)}`,
      'x-content-type-options': 'nosniff',
    });
  });

  app.put('/:id', async (c) => {
    const row = load(parseId(c.req.param('id')));
    mustBeInReview(row);
    const data = parse(invoiceDataSchema, await readJson(c));
    const productIds = [...new Set(data.lines.map((l) => l.product_id).filter((v): v is number => v !== null))];
    for (const pid of productIds) {
      if (!db.prepare('SELECT 1 FROM products WHERE id = ?').get(pid)) {
        throw new HttpError(400, `Product #${pid} does not exist.`);
      }
    }
    db.prepare(
      `UPDATE invoice_extractions SET data_json = ?, supplier_name = ?, invoice_number = ?, invoice_date = ?, total = ?,
       updated_at = ${NOW} WHERE id = ?`,
    ).run(JSON.stringify(data), data.supplier_name, data.invoice_number, data.invoice_date, data.total, row.id);
    return c.json(detail(load(row.id)));
  });

  app.post('/:id/confirm', (c) => {
    const row = load(parseId(c.req.param('id')));
    mustBeInReview(row);
    const issues = checkInvoice(JSON.parse(row.data_json));
    const errors = issues.filter((i) => i.level === 'error');
    if (errors.length) throw new HttpError(409, 'Fix the errors before confirming.', { issues: errors });
    db.prepare(
      `UPDATE invoice_extractions SET status = 'confirmed', decided_by = ?, decided_at = ${NOW}, updated_at = ${NOW} WHERE id = ?`,
    ).run(c.get('user').id, row.id);
    return c.json(detail(load(row.id)));
  });

  app.post('/:id/reject', async (c) => {
    const row = load(parseId(c.req.param('id')));
    mustBeInReview(row);
    const { reason } = parse(rejectInvoiceSchema, await readJson(c));
    db.prepare(
      `UPDATE invoice_extractions SET status = 'rejected', rejected_reason = ?, decided_by = ?, decided_at = ${NOW},
       updated_at = ${NOW} WHERE id = ?`,
    ).run(reason, c.get('user').id, row.id);
    return c.json(detail(load(row.id)));
  });

  app.post('/:id/reopen', (c) => {
    const row = load(parseId(c.req.param('id')));
    if (row.status !== 'rejected') throw new HttpError(409, 'Only a rejected invoice can be reopened.');
    db.prepare(
      `UPDATE invoice_extractions SET status = 'review', rejected_reason = NULL, decided_by = NULL, decided_at = NULL,
       updated_at = ${NOW} WHERE id = ?`,
    ).run(row.id);
    return c.json(detail(load(row.id)));
  });

  app.delete('/:id', (c) => {
    const row = load(parseId(c.req.param('id')));
    if (row.status === 'confirmed') throw new HttpError(409, 'A confirmed invoice cannot be deleted.');
    db.prepare('DELETE FROM invoice_extractions WHERE id = ?').run(row.id);
    return c.json({ ok: true });
  });

  return app;
}
