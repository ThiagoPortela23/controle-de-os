import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { createApp } from '../server/src/app.js';
import { createMailer } from '../server/src/email.js';
import { testDatabase, testConfig, seed } from './helpers.js';

const binary = process.env.MAILPIT_BINARY || (process.platform === 'win32' ? resolve('.test-data/mailpit/mailpit.exe') : 'mailpit');
const mailpit = spawn(binary, ['--listen', '127.0.0.1:18025', '--smtp', '127.0.0.1:11025'], { windowsHide: true, stdio: 'ignore' });
let mailpitError: Error | undefined;
mailpit.on('error', error => { mailpitError = error; });
async function waitForMailpit() {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (mailpitError) throw new Error('Mailpit não encontrado. Defina MAILPIT_BINARY ou instale o executável conforme README.');
    if (mailpit.exitCode !== null) throw new Error('Mailpit não iniciou. Verifique as portas 18025 e 11025.');
    try { if ((await fetch('http://127.0.0.1:18025/api/v1/messages')).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Mailpit não respondeu.');
}
try {
  await waitForMailpit();
  const database = await testDatabase();
  const config = { ...testConfig(database.url, 3317), SMTP_PORT: 11025 };
  await seed(database.pool, config);
  const app = createApp(database.pool, config, createMailer(config));
  const server = app.listen(config.PORT, '127.0.0.1');
  let stopping = false;
  const shutdown = () => {
    if (stopping) return; stopping = true;
    void app.locals.realtime.close();
    server.close(async () => {
      app.locals.sessionStore.close(); await database.stop(); mailpit.kill(); process.exit(0);
    });
  };
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
} catch (error) { mailpit.kill(); console.error(error instanceof Error ? error.message : 'Falha no ambiente de teste.'); process.exit(1); }
