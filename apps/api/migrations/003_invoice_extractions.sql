-- A supplier's PDF invoice, what was read from it, and what a person corrected
-- it to. This is an inbox, not the books: a confirmed extraction becomes a
-- supplier invoice once purchasing exists.
CREATE TABLE invoice_extractions (
  id INTEGER PRIMARY KEY,
  file_name TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  file_sha256 TEXT NOT NULL UNIQUE,
  file_data BLOB NOT NULL,
  page_count INTEGER NOT NULL,
  raw_text TEXT NOT NULL,
  -- review | confirmed | rejected
  status TEXT NOT NULL DEFAULT 'review',
  -- JSON of InvoiceData exactly as extracted; never changed afterwards
  extracted_json TEXT NOT NULL,
  -- JSON of FoundFields: the PDF line each header field came from
  found_json TEXT NOT NULL,
  -- JSON of InvoiceData as it stands now, with corrections
  data_json TEXT NOT NULL,
  -- copies of data_json fields, so the inbox can list and search without parsing JSON
  supplier_name TEXT,
  invoice_number TEXT,
  invoice_date TEXT,
  total INTEGER,
  rejected_reason TEXT,
  uploaded_by INTEGER NOT NULL REFERENCES users (id),
  decided_by INTEGER REFERENCES users (id),
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_invoice_extractions_status ON invoice_extractions (status, created_at);
CREATE INDEX idx_invoice_extractions_number ON invoice_extractions (invoice_number);
