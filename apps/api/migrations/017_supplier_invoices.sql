-- A supplier invoice records what a supplier bills for one goods receipt. It is the accounts payable:
-- total minus amount_paid is what is still owed (payments arrive with F019). Posted invoices are never
-- edited or deleted. One invoice per receipt, one supplier invoice number per supplier, and a PDF from
-- the invoice inbox can be turned into at most one invoice.
CREATE TABLE supplier_invoices (
  id INTEGER PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  supplier_invoice_no TEXT NOT NULL,
  supplier_id INTEGER NOT NULL REFERENCES suppliers (id),
  receipt_id INTEGER NOT NULL UNIQUE REFERENCES goods_receipts (id),
  order_id INTEGER NOT NULL REFERENCES purchase_orders (id),
  extraction_id INTEGER UNIQUE REFERENCES invoice_extractions (id),
  invoice_date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  ppn_rate_bp INTEGER NOT NULL,
  dpp INTEGER NOT NULL CHECK (dpp >= 0),
  ppn INTEGER NOT NULL CHECK (ppn >= 0),
  total INTEGER NOT NULL CHECK (total >= 0),
  -- the total the supplier printed, when it was typed in or read from the PDF
  stated_total INTEGER,
  amount_paid INTEGER NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  created_by INTEGER NOT NULL REFERENCES users (id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX idx_supplier_invoices_ref ON supplier_invoices (supplier_id, supplier_invoice_no COLLATE NOCASE);
CREATE INDEX idx_supplier_invoices_due ON supplier_invoices (due_date);
CREATE TABLE supplier_invoice_lines (
  id INTEGER PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES supplier_invoices (id),
  product_id INTEGER NOT NULL REFERENCES products (id),
  qty_milli INTEGER NOT NULL CHECK (qty_milli > 0),
  unit_cost INTEGER NOT NULL CHECK (unit_cost >= 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (invoice_id, product_id)
);
