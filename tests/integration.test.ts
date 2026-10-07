import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { writeFile, mkdir } from 'node:fs/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createApp } from '../server/src/app.js';
import { migrate } from '../server/src/db.js';
import type { Delivery } from '../server/src/types.js';
import { seed, testConfig, testDatabase } from './helpers.js';

let database: Awaited<ReturnType<typeof testDatabase>>;
let app: ReturnType<typeof createApp>;
const deliveries: Delivery[] = [];
let failEmail = false;
type Agent = ReturnType<typeof request.agent>;
type Account = { agent: Agent; csrf: string; id: string };
let admin: Account, ana: Account, bruno: Account, carlos: Account, diana: Account;
async function login(email: string, password = 'TestPassword123!'): Promise<Account> {
  const agent = request.agent(app);
  const csrf = (await agent.get('/api/auth/csrf').expect(200)).body.csrfToken;
  const result = await agent.post('/api/auth/login').set('x-csrf-token', csrf).send({ email, password }).expect(200);
  return { agent, csrf: result.body.csrfToken, id: result.body.user.id };
}
function post(account: Account, endpoint: string, body: object = {}) {
  return account.agent.post(`/api${endpoint}`).set('x-csrf-token', account.csrf).send(body);
}
async function opened(description = 'Impressora não está funcionando.') {
  return (await post(ana, '/orders', { title: 'Impressora com falha', description }).expect(201)).body;
}
async function resolved() {
  const order = await opened();
  await post(admin, `/orders/${order.id}/assign`, { technicianId: carlos.id }).expect(200);
  await post(carlos, `/orders/${order.id}/resolve`, { solution: 'Conexão corrigida e impressão testada.' }).expect(200);
  return { order, token: deliveries.at(-1)!.token };
}
before(async () => {
  database = await testDatabase(); const config = testConfig(database.url); await seed(database.pool, config);
  app = createApp(database.pool, config, async delivery => { deliveries.push(delivery); if (failEmail) throw new Error('SMTP offline'); });
  admin = await login('admin@example.com', 'InitialAdmin123!'); ana = await login('ana@example.com');
  bruno = await login('bruno@example.com'); carlos = await login('carlos@example.com'); diana = await login('diana@example.com');
}, { timeout: 60_000 });
// Keep shared historical fixtures while giving each scenario a fresh opening quota.
beforeEach(async () => { await database.pool.query("UPDATE orders SET created_at=NOW()-INTERVAL '2 hours' WHERE created_at>NOW()-INTERVAL '1 hour'"); });
after(async () => { await app?.locals.realtime.close(); app?.locals.sessionStore.close(); await database?.stop(); });

test('migrations são idempotentes e o banco é PostgreSQL 17', async () => {
  await migrate(database.pool);
  assert.match((await database.pool.query('SELECT version()')).rows[0].version, /PostgreSQL 17/);
  assert.equal((await database.pool.query('SELECT count(*) FROM schema_migrations')).rows[0].count, '2');
});
test('sessão persistida, cookie HttpOnly e bloqueio CSRF/origem', async () => {
  assert.ok(Number((await database.pool.query('SELECT count(*) FROM sessions')).rows[0].count) >= 5);
  const response = await request(app).get('/api/auth/csrf').expect(200);
  assert.match(response.headers['set-cookie'][0], /HttpOnly/); assert.match(response.headers['set-cookie'][0], /SameSite=Strict/);
  await ana.agent.post('/api/orders').send({ title: 'Teste', description: 'Falha CSRF' }).expect(403);
  await post(ana, '/orders', { title: 'Teste', description: 'Falha origem' }).set('Origin', 'https://evil.example').expect(403);
  await request(app).get('/api/orders').expect(401);
});
test('senha inicial deve ser trocada; contas duplicadas e permissões de usuário', async () => {
  await post(ana, '/users', {}).expect(403);
  const created = await post(admin, '/users', { name: 'Eva Inicial', email: 'eva@example.com', role: 'REQUESTER', temporaryPassword: 'Temporary123!' }).expect(201);
  assert.equal(created.body.password_hash, undefined);
  await post(admin, '/users', { name: 'Duplicada', email: 'EVA@example.com', role: 'REQUESTER', temporaryPassword: 'Temporary123!' }).expect(409);
  const eva = await login('eva@example.com', 'Temporary123!');
  await eva.agent.get('/api/orders').expect(403);
  const changed = await post(eva, '/auth/password', { currentPassword: 'Temporary123!', newPassword: 'Permanent123!' }).expect(200);
  eva.csrf = changed.body.csrfToken;
  await eva.agent.get('/api/orders').expect(200);
  await admin.agent.patch(`/api/users/${eva.id}`).set('x-csrf-token', admin.csrf).send({ active: false }).expect(200);
  await eva.agent.get('/api/orders').expect(401);
  await admin.agent.patch(`/api/users/${admin.id}`).set('x-csrf-token', admin.csrf).send({ active: false }).expect(400);
});
test('OS e PDF limitados ao solicitante e técnico corretos', async () => {
  const order = await opened();
  await bruno.agent.get(`/api/orders/${order.id}`).expect(404); await bruno.agent.get(`/api/orders/${order.id}/pdf`).expect(404);
  await carlos.agent.get(`/api/orders/${order.id}`).expect(404);
  await post(ana, `/orders/${order.id}/assign`, { technicianId: carlos.id }).expect(403);
  await post(admin, `/orders/${order.id}/assign`, { technicianId: carlos.id }).expect(200);
  await diana.agent.get(`/api/orders/${order.id}/pdf`).expect(404);
  await post(diana, `/orders/${order.id}/resolve`, { solution: 'Solução indevida.' }).expect(403);
  await post(admin, `/orders/${order.id}/resolve`, { solution: 'Solução pelo admin.' }).expect(403);
  assert.ok((await carlos.agent.get('/api/orders').expect(200)).body.items.some((item: { id: string }) => item.id === order.id));
  assert.ok(!(await bruno.agent.get('/api/orders').expect(200)).body.items.some((item: { id: string }) => item.id === order.id));
});
test('atribuições simultâneas preservam histórico; técnico anterior perde acesso', async () => {
  const order = await opened();
  const results = await Promise.all([post(admin, `/orders/${order.id}/assign`, { technicianId: carlos.id }), post(admin, `/orders/${order.id}/assign`, { technicianId: diana.id })]);
  assert.deepEqual(results.map(result => result.status), [200, 200]);
  const detail = (await admin.agent.get(`/api/orders/${order.id}`).expect(200)).body;
  assert.equal(detail.events.filter((event: { kind: string }) => event.kind === 'ASSIGNED').length, 2);
  const previous = detail.technician_id === carlos.id ? diana : carlos;
  await previous.agent.get(`/api/orders/${order.id}`).expect(404);
});
test('resolução envia link; GET não aceita; resposta é única e não expõe hash', async () => {
  const { order, token } = await resolved();
  const detail = (await ana.agent.get(`/api/orders/${order.id}`).expect(200)).body;
  assert.equal(detail.status, 'RESOLVED'); assert.equal(detail.acceptance, 'PENDING');
  assert.equal(detail.confirmations[0].token_hash, undefined); assert.equal(detail.confirmations[0].email_status, 'SENT');
  const hash = (await database.pool.query('SELECT token_hash FROM confirmations WHERE order_id=$1', [order.id])).rows[0].token_hash;
  assert.notEqual(hash, token);
  await request(app).get(`/api/confirmations/${token}`).expect(200);
  assert.equal((await ana.agent.get(`/api/orders/${order.id}`)).body.acceptance, 'PENDING');
  await request(app).post(`/api/confirmations/${token}`).send({ response: 'CONFIRMED' }).expect(200);
  await request(app).post(`/api/confirmations/${token}`).send({ response: 'CONFIRMED' }).expect(410);
  assert.equal((await ana.agent.get(`/api/orders/${order.id}`)).body.acceptance, 'CONFIRMED');
  await post(admin, `/orders/${order.id}/resend`).expect(409);
  await post(admin, `/orders/${order.id}/assign`, { technicianId: carlos.id }).expect(409);
});
test('recusa exige motivo, reabre, remove atribuição e preserva atendimento anterior', async () => {
  const { order, token } = await resolved();
  await request(app).post(`/api/confirmations/${token}`).send({ response: 'REJECTED', reason: ' ' }).expect(400);
  await request(app).post(`/api/confirmations/${token}`).send({ response: 'REJECTED', reason: 'A falha voltou após o teste.' }).expect(200);
  const detail = (await ana.agent.get(`/api/orders/${order.id}`)).body;
  assert.equal(detail.status, 'OPEN'); assert.equal(detail.technician_id, null); assert.equal(detail.acceptance, 'REJECTED');
  assert.ok(detail.events.some((event: { message: string }) => event.message.includes('Conexão corrigida')));
  assert.equal(detail.confirmations[0].reason, 'A falha voltou após o teste.');
  await carlos.agent.get(`/api/orders/${order.id}`).expect(404);
  await post(admin, `/orders/${order.id}/assign`, { technicianId: carlos.id }).expect(200);
  await post(carlos, `/orders/${order.id}/resolve`, { solution: 'Cabo substituído e teste concluído.' }).expect(200);
  const updated = (await ana.agent.get(`/api/orders/${order.id}`)).body;
  assert.equal(updated.resolution_version, 2); assert.equal(updated.acceptance, 'PENDING');
  await request(app).get(`/api/confirmations/${token}`).expect(410);
});
test('reenvio invalida token anterior; prazo de 72 horas e token expirado', async () => {
  const { order, token } = await resolved();
  await post(bruno, `/orders/${order.id}/resend`).expect(403);
  await post(diana, `/orders/${order.id}/resend`).expect(403);
  await post(carlos, `/orders/${order.id}/resend`).expect(200);
  const current = deliveries.at(-1)!;
  assert.notEqual(current.token, token);
  const duration = current.confirmation.expires_at.getTime() - current.confirmation.created_at.getTime();
  assert.equal(duration, 72 * 60 * 60 * 1000);
  await request(app).get(`/api/confirmations/${token}`).expect(410);
  await database.pool.query("UPDATE confirmations SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1", [current.confirmation.id]);
  await request(app).get(`/api/confirmations/${current.token}`).expect(410);
  await request(app).post(`/api/confirmations/${current.token}`).send({ response: 'CONFIRMED' }).expect(410);
  assert.equal((await ana.agent.get(`/api/orders/${order.id}`)).body.acceptance, 'PENDING');
});
test('respostas simultâneas registram exatamente um aceite', async () => {
  const { order, token } = await resolved();
  const results = await Promise.all([
    request(app).post(`/api/confirmations/${token}`).send({ response: 'CONFIRMED' }),
    request(app).post(`/api/confirmations/${token}`).send({ response: 'REJECTED', reason: 'Problema persiste.' }),
  ]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 410]);
  const detail = (await ana.agent.get(`/api/orders/${order.id}`)).body;
  assert.equal(detail.events.filter((event: { kind: string }) => ['CONFIRMED', 'REJECTED'].includes(event.kind)).length, 1);
});
test('falha de SMTP mantém resolução e permite recuperação por reenvio', async () => {
  failEmail = true;
  let result: Awaited<ReturnType<typeof resolved>>;
  try { result = await resolved(); } finally { failEmail = false; }
  const detail = (await ana.agent.get(`/api/orders/${result!.order.id}`)).body;
  assert.equal(detail.status, 'RESOLVED'); assert.equal(detail.acceptance, 'PENDING'); assert.equal(detail.confirmations[0].email_status, 'FAILED');
  await post(admin, `/orders/${result!.order.id}/resend`).expect(200);
  assert.equal((await ana.agent.get(`/api/orders/${result!.order.id}`)).body.confirmations[0].email_status, 'SENT');
});
test('filtros combinados, datas de Brasília, validação e paginação', async () => {
  const boundary = await opened();
  await database.pool.query("UPDATE orders SET created_at='2026-10-04T02:59:59Z' WHERE id=$1", [boundary.id]);
  const query = `/api/orders?from=2026-10-03&to=2026-10-03&requester=ana&number=${boundary.number}`;
  assert.equal((await admin.agent.get(query).expect(200)).body.total, 1);
  assert.equal((await admin.agent.get(`/api/orders?from=2026-10-04&number=${boundary.number}`)).body.total, 0);
  await database.pool.query("UPDATE orders SET created_at='2026-10-05T02:59:59Z' WHERE id=$1", [boundary.id]);
  assert.equal((await admin.agent.get(`/api/orders?from=2026-10-04&to=2026-10-04&number=${boundary.number}`)).body.total, 1);
  await admin.agent.get('/api/orders?from=2026-02-30').expect(400);
  await admin.agent.get('/api/orders?from=2026-10-05&to=2026-10-04').expect(400);
  await admin.agent.get('/api/orders?number=abc').expect(400);
  await admin.agent.get('/api/orders?page=0').expect(400);
  assert.equal((await admin.agent.get('/api/orders?requester=%25')).body.total, 0);
  // Bulk historical fixtures are not new submissions subject to the opening quota.
  for (let index = 0; index < 22; index++) await database.pool.query(
    `INSERT INTO orders(requester_id,requester_name,requester_email,title,description,created_at)
     VALUES ($1,'Bruno Solicitante','bruno@example.com',$2,'Ordem para paginação.',NOW()-INTERVAL '2 hours')`, [bruno.id, `Consulta ${index}`]);
  const first = (await bruno.agent.get('/api/orders?page=1')).body;
  const second = (await bruno.agent.get('/api/orders?page=2')).body;
  assert.equal(first.items.length, 20); assert.equal(second.items.length, 2); assert.equal(first.total, 22);
  assert.equal(new Set([...first.items, ...second.items].map((order: { id: string }) => order.id)).size, 22);
});
test('PDF desde abertura, acentos e conteúdo longo distribuído em páginas', async () => {
  const order = (await database.pool.query(
    `INSERT INTO orders(requester_id,requester_name,requester_email,title,description,created_at)
     VALUES ($1,'Ana Solicitante','ana@example.com','Registro antigo com texto longo',$2,NOW()-INTERVAL '1 year') RETURNING *`,
    [ana.id, 'Descrição: conexão, impressão e solução.\n'.repeat(260)],
  )).rows[0];
  const result = await ana.agent.get(`/api/orders/${order.id}/pdf`).buffer(true).expect(200);
  assert.match(result.headers['content-disposition'], new RegExp(`OS-${order.number}\\.pdf`));
  const loadingTask = getDocument({ data: new Uint8Array(result.body), useSystemFonts: true });
  const pdf = await loadingTask.promise;
  assert.ok(pdf.numPages >= 3);
  let text = '';
  for (let page = 1; page <= pdf.numPages; page++) {
    const content = await (await pdf.getPage(page)).getTextContent();
    text += content.items.map(item => 'str' in item ? item.str : '').join(' ');
  }
  assert.match(text, /Ana Solicitante/); assert.match(text, /conexão/); assert.match(text, /Página 1 de/);
  await mkdir('test-results', { recursive: true }); await writeFile('test-results/long-order.pdf', result.body);
  await loadingTask.destroy();
});
test('PDF confirmado contém técnico, solução e registro de aceite', async () => {
  const { order, token } = await resolved();
  await request(app).post(`/api/confirmations/${token}`).send({ response: 'CONFIRMED' }).expect(200);
  const result = await ana.agent.get(`/api/orders/${order.id}/pdf`).buffer(true).expect(200);
  const loadingTask = getDocument({ data: new Uint8Array(result.body), useSystemFonts: true });
  const pdf = await loadingTask.promise;
  let text = '';
  for (let index = 1; index <= pdf.numPages; index++) text += (await (await pdf.getPage(index)).getTextContent()).items.map(item => 'str' in item ? item.str : '').join(' ');
  assert.match(text, /Carlos Técnico/); assert.match(text, /Conexão corrigida/); assert.match(text, /Aceite: Confirmado/); assert.match(text, /Data do aceite\/recusa/);
  await writeFile('test-results/confirmed-order.pdf', result.body); await loadingTask.destroy();
});
