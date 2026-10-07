import { readConfig } from './config.js';
import { createPool, migrate } from './db.js';
const pool = createPool(readConfig().DATABASE_URL);
try { await migrate(pool); console.log('Migrations aplicadas.'); }
finally { await pool.end(); }
