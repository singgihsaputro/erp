-- A batch is a lot of one product with a batch number and (optionally) an expiry date.
-- Stock stays a ledger: a move may carry a batch_id, and a batch's on-hand is the sum of its moves.
-- Moves without a batch are untracked stock and keep working as before.
CREATE TABLE stock_batches (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products (id),
  batch_no TEXT NOT NULL,
  expiry_date TEXT CHECK (expiry_date IS NULL OR expiry_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (product_id, batch_no)
);
ALTER TABLE stock_moves ADD COLUMN batch_id INTEGER REFERENCES stock_batches (id);
CREATE INDEX idx_stock_moves_batch ON stock_moves (batch_id) WHERE batch_id IS NOT NULL;
