# ERP

An ERP for Indonesian retail and distribution SMEs: products and stock across
warehouses, purchasing, sales and invoicing with PPN, a point of sale, and the
accounting underneath. It is built one feature a night by a scheduled agent, in
the order of [ROADMAP.md](ROADMAP.md); [CHANGELOG.md](CHANGELOG.md) says what
each night added.

## Modules

Nothing yet — the first night builds the skeleton and the product catalogue.

## How to run

Needs Node 22.

```bash
npm ci
npm run seed
npm run dev
```

The app is on http://localhost:5173 and the API on http://localhost:3001.

```bash
npm run verify     # typecheck, tests and build — what the nightly job checks
```

## Stack

TypeScript throughout: Hono and SQLite for the API, React 19 with Vite and
Tailwind CSS v4 for the web app, zod schemas shared between them, Vitest for
tests. The conventions every feature follows are in [CLAUDE.md](CLAUDE.md).

All data is demo data. Nothing here talks to a real payment gateway, tax system
or marketplace; those sit behind interfaces with mock implementations.
