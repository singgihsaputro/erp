# Roadmap

One line is one night's feature, built top to bottom. The nightly agent takes the
first unchecked line, delivers it, and ticks it with the night's date. Reorder,
add or remove lines freely — the agent reads this file fresh every night.

Format: `- [ ] F000 Title — what a user can do when it ships`

## Foundation and master data

- [x] F001 Products — the app skeleton (sidebar layout, API, database, tests, seed) plus a product catalogue: list, search, create, edit and archive products with SKU, barcode, name, base unit, cost and selling price — 2026-11-03
- [ ] F002 Categories and units — product categories, and units of measure with conversions to the base unit (1 box = 12 pcs, 1 karung = 25 kg)
- [ ] F003 Warehouses — several stock locations (main store, gudang), each with its own stock
- [ ] F004 Suppliers — supplier directory with contact person, address, NPWP and payment terms (cash, net 14, net 30)
- [ ] F005 Customers — customer directory with NPWP, credit limit, payment terms and a price tier (retail, grosir, member)
- [ ] F006 Users and roles — sign-in with seeded accounts; owner, admin, cashier and warehouse roles; each screen and endpoint checks the role
- [ ] F007 Company settings — company name, address, NPWP, logo, PPN rate, and document number prefixes

## Inventory

- [ ] F008 Opening stock and the stock ledger — enter opening balances, see on-hand per product per warehouse, and a product's full movement history with moving-average cost
- [ ] F009 Stock adjustments — adjust stock up or down with a reason (damaged, lost, expired, correction), posted to the ledger
- [ ] F010 Stock transfers — move stock between warehouses, with an in-transit state until received
- [ ] F011 Reorder points — set a minimum per product per warehouse and see everything below it
- [ ] F012 Stock opname — print a count sheet, enter the physical count, review the variance, and post the adjustments
- [ ] F013 Batches and expiry — track batch numbers and expiry dates, pick first-expired-first-out, and list stock expiring soon

## Purchasing

- [ ] F014 Purchase orders — create, submit and approve purchase orders, and print them
- [ ] F015 Goods receipt — receive against a purchase order, partially or in full, posting stock in at cost
- [ ] F016 Supplier invoices — record the supplier's invoice against the receipt, with three-way match warnings, creating accounts payable
- [ ] F017 Supplier payments — pay one or several invoices, and see accounts payable aging
- [ ] F018 Purchase returns — return goods to a supplier, reducing stock and the amount owed

## Sales

- [ ] F019 Quotations and sales orders — quote a customer, convert the quote to a sales order, and reserve stock
- [ ] F020 Surat Jalan — deliver against a sales order, partially or in full, posting stock out; printable delivery note
- [ ] F021 Sales invoices — invoice delivered goods with DPP, PPN and total; printable Faktur-style invoice
- [ ] F022 Customer payments — receive payments against invoices, block new orders past the credit limit, and see accounts receivable aging
- [ ] F023 Sales returns — accept returned goods back into stock and issue a credit note
- [ ] F024 Price lists — prices per tier and quantity breaks (grosir price from 10 pcs), used automatically on orders and at the POS
- [ ] F025 Promotions — percentage and fixed discounts, buy-X-get-Y, with start and end dates

## Point of sale

- [ ] F026 POS checkout — scan or search products, cart, cash payment with change, and a printable 58/80mm receipt
- [ ] F027 Cashier shifts — open a shift with a starting float, close it with a cash count, and print the shift report with over/short
- [ ] F028 Payment methods — QRIS, bank transfer, debit card and split payments, recorded per transaction (mock, no gateway)
- [ ] F029 Hold and recall — park a sale, serve the next customer, and resume it; void with a supervisor's approval

## Accounting

- [ ] F030 Chart of accounts — a standard Indonesian SME chart of accounts, editable
- [ ] F031 Automatic journals — every posted sale, purchase, payment, stock move and return writes a balanced journal entry
- [ ] F032 Manual journals — enter, post and reverse general journal entries
- [ ] F033 Cash, bank and expenses — cash and bank accounts, transfers between them, and recording operating expenses
- [ ] F034 General ledger and trial balance — per-account ledger with running balance, and a trial balance for any period
- [ ] F035 Profit and loss — income statement for a period, comparable with the previous one
- [ ] F036 Balance sheet — assets, liabilities and equity as at any date
- [ ] F037 PPN report — output tax versus input tax for a tax period, exportable

## Reports and dashboard

- [ ] F038 Dashboard — today's sales, top products, stock below reorder point, receivables and payables falling due
- [ ] F039 Sales reports — by product, category, customer and period, exportable to CSV
- [ ] F040 Inventory valuation — stock value at moving-average cost as at any date, and a movement summary per product
- [ ] F041 Purchase reports — by supplier, product and period, exportable to CSV
- [ ] F042 Gross margin — margin by product and category for a period

## Platform

- [ ] F043 Audit log — who created, changed, posted or voided what, and when
- [ ] F044 CSV import — import products, customers and suppliers from CSV with row-level error reporting
- [ ] F045 Bahasa Indonesia — switch the whole interface between Indonesian and English
- [ ] F046 Print templates — shared print layout for invoice, purchase order, Surat Jalan and receipt with the company logo
- [ ] F047 Backup and restore — download the database and restore from a backup, owner only
- [ ] F048 Branches — several stores, each with its own warehouses, POS and reports, plus a consolidated view
- [ ] F049 Approval rules — configurable approvals, such as purchase orders above an amount needing the owner
- [ ] F050 Notifications — an in-app inbox for invoices falling due, low stock, expiring batches and pending approvals

## Next

When every line above is ticked, add the next five features a retail and
distribution client would ask for, then build the first of them.
