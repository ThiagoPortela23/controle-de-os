import type { Pool } from 'pg';
import type { Config } from './config.js';
import { hashPassword } from './security.js';

export async function bootstrapAdmin(pool: Pool, config: Config) {
  await pool.query(
    `INSERT INTO users(name,email,password_hash,role) VALUES ($1,$2,$3,'ADMIN') ON CONFLICT (email) DO NOTHING`,
    [config.ADMIN_NAME, config.ADMIN_EMAIL.toLowerCase(), await hashPassword(config.ADMIN_PASSWORD)],
  );
}
