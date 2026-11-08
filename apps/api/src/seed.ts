import fs from 'node:fs';
import { defaultDbPath, openDb } from './db.js';
import { createApp } from './app.js';
import { seedDemo, seedInvoices, seedUsers } from './seed-data.js';

const file = defaultDbPath();
for (const suffix of ['', '-wal', '-shm', '-journal']) fs.rmSync(file + suffix, { force: true });
const db = openDb(file);
createApp(db); // creates the super admin, as the server does on first start
seedDemo(db);
seedUsers(db);
await seedInvoices(db);
db.close();
console.log(`Seeded demo data into ${file}`);
console.log('Sign in as admin / superuser (Super Admin).');
console.log('Demo staff (budi.owner, sari.admin, dewi.kasir, agus.gudang) use password demo-12345.');
