import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';

const docker = process.env.DOCKER_BINARY || 'docker';
const capture = args => execFileSync(docker, args, { encoding: 'utf8', windowsHide: true, timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });

async function main() {
  assert.equal(capture(['info', '--format', '{{.OSType}}']).trim(), 'linux', 'Selecione o engine Linux no Docker Desktop.');
  capture(['compose', 'config', '--quiet']);
  // Configuration can contain secrets: keep it in memory and never log or save it.
  const config = JSON.parse(capture(['compose', 'config', '--format', 'json']));
  const portOf = (service, target) => {
    const binding = config.services[service].ports.find(port => Number(port.target) === target && port.protocol === 'tcp');
    assert.ok(binding?.published, `Porta ${target} não publicada para ${service}.`);
    return Number(binding.published);
  };
  const up = spawnSync(docker, ['compose', 'up', '--build', '-d', '--wait', '--wait-timeout', '120'], {
    stdio: 'inherit', windowsHide: true,
  });
  if (up.error) throw up.error;
  assert.equal(up.status, 0, 'Falha ao construir ou iniciar os containers.');

  const appUrl = `http://127.0.0.1:${portOf('app', 3000)}`;
  const mailpitUrl = `http://127.0.0.1:${portOf('mailpit', 8025)}`;
  async function getJson(url, expected = 200) {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    assert.equal(response.status, expected, `HTTP inesperado para ${new URL(url).pathname}.`);
    return response.json();
  }
  assert.equal((await getJson(`${appUrl}/api/health`)).status, 'ok');
  console.log('OK: aplicação e conexão com o banco.');

  const home = await fetch(appUrl, { signal: AbortSignal.timeout(10_000) });
  assert.equal(home.status, 200);
  const html = await home.text();
  assert.match(html, /Central de Serviços/);
  assert.match(html, /<div id="root"><\/div>/);
  const asset = html.match(/src="([^\"]+\.js)"/);
  assert.ok(asset, 'Bundle React não encontrado.');
  const bundle = await fetch(new URL(asset[1], appUrl), { signal: AbortSignal.timeout(10_000) });
  assert.equal(bundle.status, 200);
  assert.match(bundle.headers.get('content-type') || '', /javascript/);
  const logo = await fetch(new URL('/logo.svg', appUrl), { signal: AbortSignal.timeout(10_000) });
  assert.equal(logo.status, 200);
  assert.match(await logo.text(), /<svg/);
  console.log('OK: frontend React compilado e servido.');

  await getJson(`${appUrl}/api/orders`, 401);
  await getJson(`${appUrl}/api/dashboard?year=2026&month=1`, 401);
  await getJson(`${appUrl}/api/events`, 401);
  const csrf = await fetch(`${appUrl}/api/auth/csrf`, { signal: AbortSignal.timeout(10_000) });
  assert.equal(csrf.status, 200);
  const csrfToken = (await csrf.json()).csrfToken;
  assert.ok(csrfToken);
  assert.match(csrf.headers.get('set-cookie') || '', /HttpOnly/i);
  const rejected = await fetch(`${appUrl}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(10_000),
  });
  assert.equal(rejected.status, 403);
  const cookie = csrf.headers.get('set-cookie').split(';')[0];
  const origin = new URL(config.services.app.environment.APP_PUBLIC_URL).origin;
  const allowed = await fetch(`${appUrl}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: origin, 'X-CSRF-Token': csrfToken },
    body: '{}', signal: AbortSignal.timeout(10_000),
  });
  assert.equal(allowed.status, 400, 'A origem configurada deve alcançar a validação do login.');
  const foreign = await fetch(`${appUrl}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: 'https://foreign.example', 'X-CSRF-Token': csrfToken },
    body: '{}', signal: AbortSignal.timeout(10_000),
  });
  assert.equal(foreign.status, 403);
  console.log('OK: sessão, autenticação obrigatória e proteção CSRF.');

  const database = JSON.parse(capture(['compose', 'exec', '-T', 'db', 'psql', '-U', 'os', '-d', 'controle_os', '-At', '-c',
    `SELECT json_build_object(
      'major', current_setting('server_version_num')::int / 10000,
      'migrations', (SELECT COUNT(*) FROM schema_migrations),
      'tables', (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('users','orders','order_events','confirmations','sessions')),
      'admin', EXISTS(SELECT 1 FROM users WHERE role='ADMIN' AND active=TRUE),
      'triggers', (SELECT COUNT(*) FROM pg_trigger WHERE tgname IN ('orders_notify','confirmation_email_notify') AND NOT tgisinternal)
    )`]).trim());
  assert.equal(database.major, 17);
  assert.ok(database.migrations >= 2);
  assert.equal(database.tables, 5);
  assert.equal(database.admin, true);
  assert.equal(database.triggers, 2);
  console.log('OK: PostgreSQL 17, migrations e administrador inicial.');

  const smtp = capture(['compose', 'exec', '-T', 'app', 'node', '--input-type=module', '-e', `
    import nodemailer from 'nodemailer';
    import { readConfig } from './dist/server/config.js';
    const config = readConfig();
    const transport = nodemailer.createTransport({
      host: config.SMTP_HOST, port: config.SMTP_PORT, secure: config.SMTP_SECURE,
      auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined,
      connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
    });
    try { await transport.verify(); console.log('SMTP_OK'); }
    catch { process.exitCode = 1; }
    finally { transport.close(); }
  `]);
  assert.equal(smtp.trim(), 'SMTP_OK', 'A aplicação não conseguiu conectar ao SMTP configurado.');
  console.log('OK: conexão SMTP a partir do container da aplicação, sem envio de mensagens.');

  const messages = await getJson(`${mailpitUrl}/api/v1/messages`);
  assert.ok(Array.isArray(messages.messages));
  console.log('OK: Mailpit disponível.');
  console.log(`Validação concluída. Navegador: ${origin} | API local: ${appUrl} | Mailpit: ${mailpitUrl}`);
}

main().catch(error => {
  // Do not print raw subprocess output or configuration; they may include credentials.
  if (error instanceof assert.AssertionError) console.error(`Validação falhou: ${error.message}`);
  else if (error.code === 'ENOENT') console.error('Docker não encontrado. Verifique o PATH ou defina DOCKER_BINARY.');
  else console.error('Validação falhou. Verifique o engine Docker, os serviços e a conexão local.');
  process.exitCode = 1;
});
