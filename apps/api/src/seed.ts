import fs from 'node:fs';
import { defaultDbPath, openDb } from './db.js';
import { seedDemo } from './seed-data.js';

const file = defaultDbPath();
for (const suffix of ['', '-wal', '-shm', '-journal']) fs.rmSync(file + suffix, { force: true });
const db = openDb(file);
seedDemo(db);
db.close();
console.log(`Seeded demo data into ${file}`);
