# Roadmap

One line is one night's feature, built top to bottom. The nightly agent takes the
first unchecked line, delivers it, and ticks it with the night's date. Reorder,
add or remove lines freely — the agent reads this file fresh every night.

Format: `- [ ] F000 Title — what a user can do when it ships`

## Foundation and master data

- [x] F001 Products — the app skeleton (sidebar layout, API, database, tests, seed) plus a product catalogue: list, search, create, edit and archive products with SKU, barcode, name, base unit, cost and selling price — 2026-11-03
- [x] F002 Sign-in and the super admin — sign in with a username and password (admin / superuser is created as Super Admin on first start), sign out, change password; every screen and endpoint needs a signed-in user — 2026-11-04
- [x] F003 PDF invoice extractor — upload a supplier's PDF invoice; the ERP reads the supplier, NPWP, invoice number, dates, lines and totals, suggests the matching products and checks the arithmetic, and an invoice inbox lets you correct, confirm or reject it — 2026-11-04
- [x] F004 Categories and units — product categories, and units of measure with conversions to the base unit (1 box = 12 pcs, 1 karung = 25 kg) — 2026-11-04
- [x] F005 Warehouses — several stock locations (main store, gudang), each with its own stock — 2026-11-05
- [x] F006 Suppliers — supplier directory with contact person, address, NPWP and payment terms (cash, net 14, net 30) — 2026-11-06
- [x] F007 Customers — customer directory with NPWP, credit limit, payment terms and a price tier (retail, grosir, member) — 2026-11-07
- [x] F008 User management — the super admin creates owner, admin, cashier and warehouse accounts, resets passwords and disables accounts; each screen and endpoint checks the role — 2026-11-08
- [x] F009 Company settings — company name, address, NPWP, logo, PPN rate, and document number prefixes — 2026-11-09

## Inventory

- [ ] F010 Opening stock and the stock ledger — enter opening balances, see on-hand per product per warehouse, and a product's full movement history with moving-average cost
- [ ] F011 Stock adjustments — adjust stock up or down with a reason (damaged, lost, expired, correction), posted to the ledger
- [ ] F012 Stock transfers — move stock between warehouses, with an in-transit state until received
- [ ] F013 Reorder points — set a minimum per product per warehouse and see everything below it
- [ ] F014 Stock opname — print a count sheet, enter the physical count, review the variance, and post the adjustments
- [ ] F015 Batches and expiry — track batch numbers and expiry dates, pick first-expired-first-out, and list stock expiring soon

## Purchasing

- [ ] F016 Purchase orders — create, submit and approve purchase orders, and print them
- [ ] F017 Goods receipt — receive against a purchase order, partially or in full, posting stock in at cost
- [ ] F018 Supplier invoices — record the supplier's invoice against the receipt, or create it from a confirmed PDF in the invoice inbox, with three-way match warnings, creating accounts payable
- [ ] F019 Supplier payments — pay one or several invoices, and see accounts payable aging
- [ ] F020 Purchase returns — return goods to a supplier, reducing stock and the amount owed

## Sales

- [ ] F021 Quotations and sales orders — quote a customer, convert the quote to a sales order, and reserve stock
- [ ] F022 Surat Jalan — deliver against a sales order, partially or in full, posting stock out; printable delivery note
- [ ] F023 Sales invoices — invoice delivered goods with DPP, PPN and total; printable Faktur-style invoice
- [ ] F024 Customer payments — receive payments against invoices, block new orders past the credit limit, and see accounts receivable aging
- [ ] F025 Sales returns — accept returned goods back into stock and issue a credit note
- [ ] F026 Price lists — prices per tier and quantity breaks (grosir price from 10 pcs), used automatically on orders and at the POS
- [ ] F027 Promotions — percentage and fixed discounts, buy-X-get-Y, with start and end dates

## Point of sale

- [ ] F028 POS checkout — scan or search products, cart, cash payment with change, and a printable 58/80mm receipt
- [ ] F029 Cashier shifts — open a shift with a starting float, close it with a cash count, and print the shift report with over/short
- [ ] F030 Payment methods — QRIS, bank transfer, debit card and split payments, recorded per transaction (mock, no gateway)
- [ ] F031 Hold and recall — park a sale, serve the next customer, and resume it; void with a supervisor's approval

## Accounting

- [ ] F032 Chart of accounts — a standard Indonesian SME chart of accounts, editable
- [ ] F033 Automatic journals — every posted sale, purchase, payment, stock move and return writes a balanced journal entry
- [ ] F034 Manual journals — enter, post and reverse general journal entries
- [ ] F035 Cash, bank and expenses — cash and bank accounts, transfers between them, and recording operating expenses
- [ ] F036 General ledger and trial balance — per-account ledger with running balance, and a trial balance for any period
- [ ] F037 Profit and loss — income statement for a period, comparable with the previous one
- [ ] F038 Balance sheet — assets, liabilities and equity as at any date
- [ ] F039 PPN report — output tax versus input tax for a tax period, exportable

## Reports and dashboard

- [ ] F040 Dashboard — today's sales, top products, stock below reorder point, receivables and payables falling due
- [ ] F041 Sales reports — by product, category, customer and period, exportable to CSV
- [ ] F042 Inventory valuation — stock value at moving-average cost as at any date, and a movement summary per product
- [ ] F043 Purchase reports — by supplier, product and period, exportable to CSV
- [ ] F044 Gross margin — margin by product and category for a period

## Platform

- [ ] F045 Audit log — who created, changed, posted or voided what, and when
- [ ] F046 CSV import — import products, customers and suppliers from CSV with row-level error reporting
- [ ] F047 Bahasa Indonesia — switch the whole interface between Indonesian and English
- [ ] F048 Print templates — shared print layout for invoice, purchase order, Surat Jalan and receipt with the company logo
- [ ] F049 Backup and restore — download the database and restore from a backup, owner only
- [ ] F050 Branches — several stores, each with its own warehouses, POS and reports, plus a consolidated view
- [ ] F051 Approval rules — configurable approvals, such as purchase orders above an amount needing the owner
- [ ] F052 Scanned invoices — read image-only PDFs and phone photos in the invoice inbox with on-device OCR, no external service
- [ ] F053 Notifications — an in-app inbox for invoices falling due, low stock, expiring batches and pending approvals

## Next

Add lines before every line above is ticked: the nightly run opens an issue for
the first unchecked line, so with none left it stops and says so.
