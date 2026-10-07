import EmbeddedPostgres from 'embedded-postgres';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { createServer } from 'node:net';
import { createPool, migrate } from '../server/src/db.js';
import { hashPassword } from '../server/src/security.js';
import { bootstrapAdmin } from '../server/src/bootstrap.js';
import type { Config } from '../server/src/config.js';

export async function availablePort() {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  return port;
}
export async function testDatabase() {
  const root = resolve('.test-data');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(resolve(root, 'postgres-'));
  if (!directory.startsWith(root + sep)) throw new Error('Diretório de teste fora do projeto.');
  const port = await availablePort();
  const database = new EmbeddedPostgres({ databaseDir: directory, port, user: 'postgres', password: 'test_only_password',
    persistent: true, initdbFlags: ['--encoding=UTF8', '--locale=C'], postgresFlags: ['-h', '127.0.0.1'], onLog: () => {}, onError: () => {} });
  await database.initialise(); await database.start();
  const url = `postgresql://postgres:test_only_password@127.0.0.1:${port}/postgres`;
  const pool = createPool(url);
  try { await migrate(pool); }
  catch (error) { await pool.end(); await database.stop(); throw error; }
  return { pool, url, stop: async () => { await pool.end(); await database.stop(); } };
}
export function testConfig(url: string, port = 3000): Config {
  return { DATABASE_URL: url, PORT: port, APP_PUBLIC_URL: `http://127.0.0.1:${port}`, NODE_ENV: 'test',
    SESSION_SECRET: 'test-secret-with-more-than-thirty-two-characters', ADMIN_NAME: 'Admin Teste',
    ADMIN_EMAIL: 'admin@example.com', ADMIN_PASSWORD: 'InitialAdmin123!', SMTP_HOST: '127.0.0.1', SMTP_PORT: 1025,
    SMTP_SECURE: false, SMTP_USER: '', SMTP_PASS: '', SMTP_FROM: 'os@example.com' };
}
export async function seed(pool: ReturnType<typeof createPool>, config: Config) {
  await bootstrapAdmin(pool, config);
  const password = await hashPassword('TestPassword123!');
  for (const [name, email, role] of [['Ana Solicitante', 'ana@example.com', 'REQUESTER'], ['Bruno Solicitante', 'bruno@example.com', 'REQUESTER'],
    ['Carlos Técnico', 'carlos@example.com', 'TECHNICIAN'], ['Diana Técnica', 'diana@example.com', 'TECHNICIAN']]) {
    await pool.query('INSERT INTO users(name,email,role,password_hash,must_change_password) VALUES ($1,$2,$3,$4,FALSE)', [name, email, role, password]);
  }
  await pool.query("UPDATE users SET must_change_password=FALSE WHERE email='admin@example.com'");
}
