# ERP

[![CI](https://github.com/singgihsaputro/erp/actions/workflows/ci.yml/badge.svg)](https://github.com/singgihsaputro/erp/actions/workflows/ci.yml)

An ERP for Indonesian retail and distribution SMEs: products and stock across
warehouses, purchasing, sales and invoicing with PPN, a point of sale, and the
accounting underneath. It is built one feature a night by a scheduled agent, in
the order of [ROADMAP.md](ROADMAP.md); [CHANGELOG.md](CHANGELOG.md) says what
each night added. Each feature arrives as an issue and a pull request that closes
it, merged once CI passes.

## Modules

- **Sign-in** — username and password, sessions, sign out, change password; roles checked on every endpoint. First start creates `admin` / `superuser` as Super Admin.
- **Products** — product catalogue: search, create, edit, archive and restore products with SKU, barcode, base unit, cost and selling price.
- **Invoice inbox** — upload a supplier's PDF invoice; the ERP reads the supplier, NPWP, number, dates, lines and totals, matches the lines to products and checks the arithmetic, then you correct, confirm or reject it.

## How to run

Needs Node 22.

```bash
npm ci
npm run seed
npm run dev
```

The app is on http://localhost:5173 and the API on http://localhost:3001.
Sign in as **`admin`** with password **`superuser`** (Super Admin), and change
the password from the header once you are in.

Sample supplier invoices to upload are in `mock/invoices/` (`npm run samples`
regenerates them).

```bash
npm run verify     # typecheck, tests and build — what the nightly job checks
```

## Stack

TypeScript throughout: Hono and SQLite for the API, React 19 with Vite and
Tailwind CSS v4 for the web app, zod schemas shared between them, Vitest for
tests. The conventions every feature follows are in [CLAUDE.md](CLAUDE.md).

All data is demo data. Nothing here talks to a real payment gateway, tax system
or marketplace; those sit behind interfaces with mock implementations.
