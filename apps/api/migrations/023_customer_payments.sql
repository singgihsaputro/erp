-- A customer payment settles one or several sales invoices of one customer. Each allocation adds
-- to the invoice's amount_paid. Posted payments are never edited or deleted.
ALTER TABLE sales_invoices ADD COLUMN amount_paid INTEGER NOT NULL DEFAULT 0 CHECK (amount_paid >= 0);
INSERT INTO document_prefixes (doc_type, prefix) VALUES ('customer_payment', 'RCV');
CREATE TABLE customer_payments (
  id INTEGER PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES customers (id),
  payment_date TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('transfer', 'cash', 'giro')),
  reference TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  total INTEGER NOT NULL CHECK (total > 0),
  created_by INTEGER NOT NULL REFERENCES users (id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_customer_payments_customer ON customer_payments (customer_id);
CREATE TABLE customer_payment_allocations (
  id INTEGER PRIMARY KEY,
  payment_id INTEGER NOT NULL REFERENCES customer_payments (id),
  invoice_id INTEGER NOT NULL REFERENCES sales_invoices (id),
  amount INTEGER NOT NULL CHECK (amount > 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (payment_id, invoice_id)
);
CREATE INDEX idx_customer_payment_alloc_invoice ON customer_payment_allocations (invoice_id);
