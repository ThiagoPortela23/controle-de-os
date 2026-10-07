import { readConfig } from './config.js';
import { createPool, migrate } from './db.js';
import { bootstrapAdmin } from './bootstrap.js';
import { createMailer } from './email.js';
import { createApp } from './app.js';

const config = readConfig();
const pool = createPool(config.DATABASE_URL);
try {
  await migrate(pool);
  await bootstrapAdmin(pool, config);
  const app = createApp(pool, config, createMailer(config));
  const server = app.listen(config.PORT, '0.0.0.0', () => console.log(`Central de Serviços disponível na porta ${config.PORT}.`));
  let stopping = false;
  const shutdown = () => {
    if (stopping) return; stopping = true;
    void app.locals.realtime.close();
    server.close(async () => { app.locals.sessionStore.close(); await pool.end(); process.exit(0); });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
} catch (error) {
  console.error(error instanceof Error ? error.message.replace(/postgres(ql)?:\/\/[^\s]+/g, '[database]') : 'Falha ao iniciar.');
  await pool.end(); process.exitCode = 1;
}
