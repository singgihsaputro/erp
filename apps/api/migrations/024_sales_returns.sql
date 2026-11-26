-- A sales return takes goods of one sales invoice back into the order's warehouse and issues a credit note
-- for them at the invoiced price and PPN rate. Posting writes an inbound ledger move per line (source_type
-- 'sales_return', at the product's current average cost so the average does not move) and credits the
-- invoice: sales_invoices.amount_credited rises by credit_applied, so what the customer owes falls.
-- credit_applied is capped at what was still outstanding; the rest (invoice already paid) is a refund
-- owed to the customer, kept as total - credit_applied. Posted returns are never edited or deleted.
ALTER TABLE sales_invoices ADD COLUMN amount_credited INTEGER NOT NULL DEFAULT 0 CHECK (amount_credited >= 0);
INSERT INTO document_prefixes (doc_type, prefix) VALUES ('credit_note', 'CN');
CREATE TABLE sales_returns (
  id INTEGER PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  credit_note_number TEXT NOT NULL UNIQUE,
  invoice_id INTEGER NOT NULL REFERENCES sales_invoices (id),
  order_id INTEGER NOT NULL REFERENCES sales_orders (id),
  customer_id INTEGER NOT NULL REFERENCES customers (id),
  warehouse_id INTEGER NOT NULL REFERENCES warehouses (id),
  return_date TEXT NOT NULL,
  reason TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  ppn_rate_bp INTEGER NOT NULL,
  dpp INTEGER NOT NULL CHECK (dpp >= 0),
  ppn INTEGER NOT NULL CHECK (ppn >= 0),
  total INTEGER NOT NULL CHECK (total >= 0),
  credit_applied INTEGER NOT NULL DEFAULT 0 CHECK (credit_applied >= 0),
  created_by INTEGER NOT NULL REFERENCES users (id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_sales_returns_invoice ON sales_returns (invoice_id);
CREATE INDEX idx_sales_returns_customer ON sales_returns (customer_id);
CREATE TABLE sales_return_lines (
  id INTEGER PRIMARY KEY,
  return_id INTEGER NOT NULL REFERENCES sales_returns (id),
  product_id INTEGER NOT NULL REFERENCES products (id),
  qty_milli INTEGER NOT NULL CHECK (qty_milli > 0),
  unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (return_id, product_id)
);
