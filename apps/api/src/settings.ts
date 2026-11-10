import { Hono } from 'hono';
import {
  DOCUMENT_TYPES,
  companyInputSchema,
  formatDocumentNumber,
  prefixesInputSchema,
  type CompanySettings,
  type DocumentPrefix,
  type DocumentType,
} from '@erp/shared';
import type { Db } from './db.js';
import { requireRole } from './auth.js';
import { HttpError, parse, readJson } from './http.js';

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

/** Who may change company settings. Everyone signed in may read them. */
export const SETTINGS_MANAGERS = ['super_admin', 'owner', 'admin'] as const;

/** The current year and month in Asia/Jakarta, as YYYY-MM. */
export function jakartaPeriod(date: Date = new Date()): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit' }).formatToParts(date);
  const get = (t: string) => p.find((x) => x.type === t)!.value;
  return `${get('year')}-${get('month')}`;
}

export function getCompany(db: Db): CompanySettings {
  return db
    .prepare('SELECT name, address, phone, email, npwp, ppn_rate_bp, logo_data_url, updated_at FROM company_settings WHERE id = 1')
    .get() as CompanySettings;
}

export function getPrefix(db: Db, type: DocumentType): string {
  const r = db.prepare('SELECT prefix FROM document_prefixes WHERE doc_type = ?').get(type) as { prefix: string } | undefined;
  if (!r) throw new Error(`Unknown document type ${type}`);
  return r.prefix;
}

/**
 * Issues the next document number, PREFIX/YYYY/MM/NNNN, sequential per prefix per
 * month. Call it inside the transaction that saves the document.
 */
export function nextDocumentNumber(db: Db, type: DocumentType, date: Date = new Date()): string {
  const prefix = getPrefix(db, type);
  const period = jakartaPeriod(date);
  const r = db
    .prepare(
      `INSERT INTO document_sequences (prefix, period, last_no) VALUES (?, ?, 1)
       ON CONFLICT (prefix, period) DO UPDATE SET last_no = last_no + 1, updated_at = ${NOW}
       RETURNING last_no`,
    )
    .get(prefix, period) as { last_no: number };
  return formatDocumentNumber(prefix, period, r.last_no);
}

export function settingsRoutes(db: Db) {
  const app = new Hono();
  const manage = requireRole(...SETTINGS_MANAGERS);

  app.get('/company', (c) => c.json(getCompany(db)));

  app.put('/company', manage, async (c) => {
    const i = parse(companyInputSchema, await readJson(c));
    db.prepare(
      `UPDATE company_settings SET name = ?, address = ?, phone = ?, email = ?, npwp = ?,
         ppn_rate_bp = ?, logo_data_url = ?, updated_at = ${NOW} WHERE id = 1`,
    ).run(i.name, i.address, i.phone, i.email, i.npwp, i.ppn_rate_bp, i.logo_data_url);
    return c.json(getCompany(db));
  });

  const listPrefixes = (): DocumentPrefix[] => {
    const period = jakartaPeriod();
    const rows = db.prepare('SELECT doc_type, prefix FROM document_prefixes').all() as { doc_type: DocumentType; prefix: string }[];
    const byType = new Map(rows.map((r) => [r.doc_type, r.prefix]));
    const last = db.prepare('SELECT last_no FROM document_sequences WHERE prefix = ? AND period = ?');
    return DOCUMENT_TYPES.map(([doc_type, label]) => {
      const prefix = byType.get(doc_type) ?? '';
      const n = (last.get(prefix, period) as { last_no: number } | undefined)?.last_no ?? 0;
      return { doc_type, label, prefix, next_number: formatDocumentNumber(prefix, period, n + 1) };
    });
  };

  app.get('/document-prefixes', (c) => c.json(listPrefixes()));

  app.put('/document-prefixes', manage, async (c) => {
    const { prefixes } = parse(prefixesInputSchema, await readJson(c));
    db.transaction(() => {
      const set = db.prepare(`UPDATE document_prefixes SET prefix = ?, updated_at = ${NOW} WHERE doc_type = ?`);
      for (const [type, prefix] of Object.entries(prefixes)) set.run(prefix, type);
      // The rows left alone must not collide with the ones just changed.
      const dup = db
        .prepare('SELECT prefix FROM document_prefixes GROUP BY prefix HAVING COUNT(*) > 1 LIMIT 1')
        .get() as { prefix: string } | undefined;
      if (dup) throw new HttpError(409, `Prefix ${dup.prefix} is already used by another document type`);
    })();
    return c.json(listPrefixes());
  });

  return app;
}
