import { Hono } from 'hono';
import { authRoutes, ensureBootstrapAdmin, requireSignIn } from './auth.js';
import type { Db } from './db.js';
import { HttpError, type AppEnv } from './http.js';
import { invoiceRoutes } from './invoices/routes.js';
import { categoryRoutes, unitRoutes } from './catalog.js';
import { productRoutes } from './products.js';
import { warehouseRoutes } from './warehouses.js';
import { supplierRoutes } from './suppliers.js';
import { customerRoutes } from './customers.js';
import { userRoutes } from './users.js';
import { settingsRoutes } from './settings.js';
import { stockRoutes } from './stock.js';
import { adjustmentRoutes } from './adjustments.js';
import { countRoutes } from './counts.js';
import { transferRoutes } from './transfers.js';
import { reorderRoutes } from './reorder.js';
import { batchRoutes } from './batches.js';
import { purchaseOrderRoutes } from './purchase-orders.js';
import { goodsReceiptRoutes } from './goods-receipts.js';
import { supplierInvoiceRoutes } from './supplier-invoices.js';
import { supplierPaymentRoutes } from './supplier-payments.js';
import { purchaseReturnRoutes } from './purchase-returns.js';

export function createApp(db: Db) {
  ensureBootstrapAdmin(db);
  const app = new Hono<AppEnv>();

  // Open to everyone. Registered before the sign-in guard, so it never runs for them.
  app.get('/api/health', (c) => c.json({ ok: true }));
  app.route('/api/auth', authRoutes(db));

  // Everything below needs a signed-in user.
  app.use('/api/*', requireSignIn(db));
  app.route('/api/products', productRoutes(db));
  app.route('/api/categories', categoryRoutes(db));
  app.route('/api/units', unitRoutes(db));
  app.route('/api/warehouses', warehouseRoutes(db));
  app.route('/api/suppliers', supplierRoutes(db));
  app.route('/api/customers', customerRoutes(db));
  app.route('/api/users', userRoutes(db));
  app.route('/api/settings', settingsRoutes(db));
  app.route('/api/stock/adjustments', adjustmentRoutes(db));
  app.route('/api/stock/transfers', transferRoutes(db));
  app.route('/api/stock/counts', countRoutes(db));
  app.route('/api/stock/reorder-points', reorderRoutes(db));
  app.route('/api/stock/batches', batchRoutes(db));
  app.route('/api/stock', stockRoutes(db));
  app.route('/api/purchase-orders', purchaseOrderRoutes(db));
  app.route('/api/goods-receipts', goodsReceiptRoutes(db));
  app.route('/api/supplier-invoices', supplierInvoiceRoutes(db));
  app.route('/api/supplier-payments', supplierPaymentRoutes(db));
  app.route('/api/purchase-returns', purchaseReturnRoutes(db));
  app.route('/api/invoice-extractions', invoiceRoutes(db));

  app.notFound((c) => c.json({ error: 'Not found' }, 404));
  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message, details: err.details }, err.status);
    console.error(err);
    return c.json({ error: 'Internal server error' }, 500);
  });

  return app;
}
