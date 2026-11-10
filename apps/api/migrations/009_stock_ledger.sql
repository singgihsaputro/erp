-- Look-ups by product for the movement history, and at most one opening balance
-- per product per warehouse (later corrections are adjustments, never edits).
CREATE INDEX idx_stock_moves_product ON stock_moves (product_id, id);
CREATE UNIQUE INDEX idx_stock_moves_one_opening ON stock_moves (product_id, warehouse_id) WHERE source_type = 'opening';
