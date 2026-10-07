import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import type { AddressInfo } from 'node:net';
import { readFile } from 'node:fs/promises';
import { Pool, type PoolClient } from 'pg';
import { createApp } from '../server/src/app.js';
import { migrate } from '../server/src/db.js';
import type { Delivery } from '../server/src/types.js';
import type { DashboardData } from '../server/src/dashboard.js';
import { seed, testConfig, testDatabase } from './helpers.js';

let database: Awaited<ReturnType<typeof testDatabase>>;
let app: ReturnType<typeof createApp>;
let server: ReturnType<typeof app.listen>;
let base: string;
const deliveries: Delivery[] = [];
type Account = { agent: ReturnType<typeof request.agent>; id: string; csrf: string; cookie: string };
let admin: Account, ana: Account, bruno: Account, carlos: Account, diana: Account;
async function login(email: string, password = 'TestPassword123!'): Promise<Account> {
  const agent = request.agent(app);
  const token = (await agent.get('/api/auth/csrf')).body.csrfToken;
  const result = await agent.post('/api/auth/login').set('x-csrf-token', token).send({ email, password }).expect(200);
  return { agent, id: result.body.user.id, csrf: result.body.csrfToken, cookie: result.headers['set-cookie'][0].split(';')[0] };
}
const post = (account: Account, path: string, body = {}) => account.agent.post(`/api${path}`).set('x-csrf-token', account.csrf).send(body);
async function fixture(account: Account, overrides: { title?: string; description?: string; created?: string; status?: string; technician?: Account; resolved?: string } = {}, client: Pool | PoolClient = database.pool) {
  return (await client.query(
    `INSERT INTO orders(requester_id,requester_name,requester_email,title,description,created_at,status,
      technician_id,technician_name,resolved_by_id,resolved_by_name,solution,resolved_at,acceptance)
     SELECT u.id,u.name,u.email,$2,$3,COALESCE($4::timestamptz,NOW()),$5,$6,t.name,
       CASE WHEN $5='RESOLVED' THEN $6::uuid END,CASE WHEN $5='RESOLVED' THEN t.name END,
       CASE WHEN $5='RESOLVED' THEN 'Solução registrada.' END,$7::timestamptz,
       CASE WHEN $5='RESOLVED' THEN 'PENDING' ELSE 'NOT_REQUESTED' END
     FROM users u LEFT JOIN users t ON t.id=$6 WHERE u.id=$1 RETURNING *`,
    [account.id, overrides.title ?? 'Chamado de teste', overrides.description ?? 'Descrição do chamado.',
      overrides.created ?? null, overrides.status ?? 'OPEN', overrides.technician?.id ?? null, overrides.resolved ?? null],
  )).rows[0];
}
async function snapshot(year: number, month: number): Promise<DashboardData> {
  return (await admin.agent.get(`/api/dashboard?year=${year}&month=${month}`).expect(200)).body;
}
async function stream(account: Account) {
  const controller = new AbortController();
  const response = await fetch(`${base}/api/events`, { headers: { Cookie: account.cookie }, signal: controller.signal });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type')!, /text\/event-stream/);
  const reader = response.body!.getReader(); const decoder = new TextDecoder(); let buffer = '';
  type Event = { name: string; data: Record<string, unknown> };
  const events: Event[] = [];
  const waiters = new Set<{ name: string; resolve: (event: Event) => void }>();
  const pump = (async () => {
    try {
      while (true) {
        const result = await reader.read(); if (result.done) break;
        buffer += decoder.decode(result.value, { stream: true });
        let end: number;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
          const name = frame.match(/^event: (.+)$/m)?.[1]; const data = frame.match(/^data: (.+)$/m)?.[1];
          if (!name || !data) continue;
          const event = { name, data: JSON.parse(data) };
          const waiter = [...waiters].find(waiter => waiter.name === name);
          if (waiter) { waiters.delete(waiter); waiter.resolve(event); } else events.push(event);
        }
      }
    } catch { /* Closing the test stream aborts its reader. */ }
  })();
  const next = (name = 'change', timeout = 2000): Promise<Event> => {
    const index = events.findIndex(event => event.name === name);
    if (index >= 0) return Promise.resolve(events.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { waiters.delete(waiter); reject(new Error(`No ${name} event`)); }, timeout);
      const waiter = { name, resolve: (event: Event) => { clearTimeout(timer); resolve(event); } }; waiters.add(waiter);
    });
  };
  await next('ready');
  return { next, close: async () => { controller.abort(); await pump; } };
}
before(async () => {
  database = await testDatabase(); const config = testConfig(database.url); await seed(database.pool, config);
  app = createApp(database.pool, config, async delivery => { deliveries.push(delivery); });
  server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  admin = await login('admin@example.com', 'InitialAdmin123!'); ana = await login('ana@example.com');
  bruno = await login('bruno@example.com'); carlos = await login('carlos@example.com'); diana = await login('diana@example.com');
}, { timeout: 60_000 });
beforeEach(async () => { await database.pool.query('TRUNCATE orders, order_events, confirmations RESTART IDENTITY'); deliveries.length = 0; });
after(async () => {
  await app?.locals.realtime.close(); app?.locals.sessionStore.close();
  if (server) await new Promise<void>(resolve => server.close(() => resolve())); await database?.stop();
});

test('limites de texto são aplicados pela API após trim', async () => {
  await post(ana, '/orders', { title: 'a'.repeat(51), description: 'Descrição válida.' }).expect(400);
  await post(ana, '/orders', { title: 'Título válido', description: 'a'.repeat(256) }).expect(400);
  await post(ana, '/orders', { title: '   ', description: '     ' }).expect(400);
  const result = await post(ana, '/orders', { title: ` ${'a'.repeat(50)} `, description: ` ${'b'.repeat(255)} ` }).expect(201);
  assert.equal(result.body.title.length, 50); assert.equal(result.body.description.length, 255);
  assert.equal((await database.pool.query('SELECT count(*) FROM orders')).rows[0].count, '1');
});
test('quota de dez aberturas é atômica, persiste entre instâncias e libera após uma hora', async () => {
  const results = await Promise.all(Array.from({ length: 12 }, (_, index) => request(base).post('/api/orders')
    .set('Cookie', bruno.cookie).set('x-csrf-token', bruno.csrf).send({ title: `Chamado ${index}`, description: 'Descrição válida.' })));
  assert.equal(results.filter(result => result.status === 201).length, 10);
  const rejected = results.filter(result => result.status === 429); assert.equal(rejected.length, 2);
  assert.ok(Number(rejected[0].headers['retry-after']) > 0);
  assert.equal((await database.pool.query('SELECT count(*) FROM order_events')).rows[0].count, '10');
  const second = createApp(database.pool, testConfig(database.url), async () => {});
  try {
    await request(second).post('/api/orders').set('Cookie', bruno.cookie).set('x-csrf-token', bruno.csrf)
      .send({ title: 'Outra instância', description: 'Descrição válida.' }).expect(429);
  } finally { await second.locals.realtime.close(); second.locals.sessionStore.close(); }
  await database.pool.query("UPDATE orders SET created_at=NOW()-INTERVAL '60 minutes' WHERE number=(SELECT MIN(number) FROM orders)");
  await post(bruno, '/orders', { title: 'Limite liberado', description: 'Descrição válida.' }).expect(201);
});
test('dashboard é exclusivo de administrador e valida o período', async () => {
  await request(app).get('/api/dashboard?year=2026&month=1').expect(401);
  await ana.agent.get('/api/dashboard?year=2026&month=1').expect(403);
  await carlos.agent.get('/api/dashboard?year=2026&month=1').expect(403);
  await admin.agent.get('/api/dashboard?year=abc&month=1').expect(400);
  await admin.agent.get('/api/dashboard?year=2026&month=13').expect(400);
  const empty = await snapshot(2026, 1);
  assert.equal(empty.monthlySeries.length, 12); assert.equal(empty.monthlyTotal, 0);
  assert.deepEqual(empty.assignedRanking, []); assert.deepEqual(empty.resolvedRanking, []);
  assert.ok(empty.monthlySeries.every(item => item.opened === 0 && item.resolved === 0));
});
test('métricas seguem datas de Brasília e carga atual; reabertura remove resolução', async () => {
  await fixture(ana, { created: '2026-02-01T02:59:59Z', status: 'ASSIGNED', technician: carlos });
  await fixture(ana, { created: '2026-02-01T03:00:00Z', status: 'ASSIGNED', technician: diana });
  await fixture(ana, { created: '2026-03-01T02:59:59Z', status: 'RESOLVED', technician: carlos, resolved: '2026-03-01T02:59:59Z' });
  await fixture(ana, { created: '2026-03-01T03:00:00Z', status: 'RESOLVED', technician: diana, resolved: '2026-03-01T03:00:00Z' });
  const data = await snapshot(2026, 2);
  assert.equal(data.monthlyTotal, 2); assert.equal(data.assigned, 2); assert.equal(data.pendingAcceptance, 2);
  assert.deepEqual(data.assignedRanking.map(item => item.name), ['Carlos Técnico', 'Diana Técnica']);
  assert.deepEqual(data.resolvedRanking.map(item => item.id), [carlos.id]);
  assert.equal(data.monthlySeries[0].opened, 1); assert.equal(data.monthlySeries[1].opened, 2);
  assert.equal(data.monthlySeries[1].resolved, 1); assert.equal(data.monthlySeries[2].resolved, 1);
  await database.pool.query(`UPDATE orders SET status='OPEN',technician_id=NULL,technician_name=NULL,
    resolved_by_id=NULL,resolved_by_name=NULL,resolved_at=NULL,solution=NULL,acceptance='REJECTED' WHERE resolved_by_id=$1`, [carlos.id]);
  assert.equal((await snapshot(2026, 2)).resolvedRanking.length, 0);
  const opened = (await post(ana, '/orders', { title: 'Atendimento completo', description: 'Descrição válida.' }).expect(201)).body;
  await post(admin, `/orders/${opened.id}/assign`, { technicianId: carlos.id }).expect(200);
  await post(admin, `/orders/${opened.id}/assign`, { technicianId: diana.id }).expect(200);
  const assigned = await snapshot(2026, 2);
  assert.equal(assigned.assignedRanking[0].id, diana.id); assert.equal(assigned.assignedRanking[0].total, 2);
  await post(diana, `/orders/${opened.id}/resolve`, { solution: 'Solução do atendimento.' }).expect(200);
  await request(app).post(`/api/confirmations/${deliveries.at(-1)!.token}`).send({ response: 'REJECTED', reason: 'Problema continua.' }).expect(200);
  assert.equal((await ana.agent.get(`/api/orders/${opened.id}`)).body.status, 'OPEN');
});
test('total diário usa limites locais e rankings limitam a cinco técnicos com desempate estável', async () => {
  const bounds = (await database.pool.query(`SELECT ((NOW() AT TIME ZONE 'America/Sao_Paulo')::date::timestamp AT TIME ZONE 'America/Sao_Paulo') AS start,
    (((NOW() AT TIME ZONE 'America/Sao_Paulo')::date+1)::timestamp AT TIME ZONE 'America/Sao_Paulo') AS finish`)).rows[0];
  await fixture(ana, { created: new Date(bounds.start).toISOString() });
  await fixture(ana, { created: new Date(new Date(bounds.start).getTime() - 1).toISOString() });
  await fixture(ana, { created: new Date(bounds.finish).toISOString() });
  for (let index = 1; index <= 6; index++) {
    const tech = (await database.pool.query(`INSERT INTO users(name,email,password_hash,role) VALUES ($1,$2,'fixture','TECHNICIAN') RETURNING id`, [`Tecnico ${index}`, `tech${index}@example.com`])).rows[0];
    await fixture(ana, { created: '2025-01-01T12:00:00Z', status: 'ASSIGNED', technician: tech });
  }
  const data = await snapshot(2026, 1); assert.equal(data.dailyTotal, 1);
  assert.deepEqual(data.assignedRanking.map(item => item.name), ['Tecnico 1', 'Tecnico 2', 'Tecnico 3', 'Tecnico 4', 'Tecnico 5']);
  await database.pool.query("UPDATE users SET active=FALSE WHERE name='Tecnico 1'");
  assert.equal((await snapshot(2026, 1)).assignedRanking[0].name, 'Tecnico 1');
});
test('SSE filtra usuários e informa ao técnico que perdeu a atribuição', async () => {
  const streams = await Promise.all([admin, ana, bruno, carlos, diana].map(stream));
  try {
    const order = (await post(ana, '/orders', { title: 'Evento privado', description: 'Descrição válida.' }).expect(201)).body;
    const alert = (await streams[0].next()).data; assert.equal(alert.kind, 'opened'); assert.equal(alert.number, order.number);
    const own = (await streams[1].next()).data; assert.equal(own.orderId, order.id); assert.equal(own.number, undefined);
    await assert.rejects(streams[2].next('change', 250)); await assert.rejects(streams[3].next('change', 250));
    await post(admin, `/orders/${order.id}/assign`, { technicianId: carlos.id }).expect(200);
    assert.equal((await streams[3].next()).data.orderId, order.id);
    await post(admin, `/orders/${order.id}/assign`, { technicianId: diana.id }).expect(200);
    assert.equal((await streams[3].next()).data.orderId, order.id);
    assert.equal((await streams[4].next()).data.orderId, order.id);
    await carlos.agent.get(`/api/orders/${order.id}`).expect(404);
  } finally { await Promise.all(streams.map(item => item.close())); }
});
test('SSE só entrega após commit; reconexão recebe ready e permite leitura atual', async () => {
  const live = await stream(admin); const client = await database.pool.connect();
  try {
    await client.query('BEGIN'); await fixture(ana, {}, client);
    await assert.rejects(live.next('change', 200)); await client.query('ROLLBACK');
    await assert.rejects(live.next('change', 200));
    await client.query('BEGIN'); const order = await fixture(ana, {}, client); await client.query('COMMIT');
    assert.equal((await live.next()).data.orderId, order.id);
    await live.close(); const reconnected = await stream(admin);
    try {
      assert.equal((await admin.agent.get('/api/orders')).body.total, 1);
      await assert.rejects(reconnected.next('change', 200));
    } finally { await reconnected.close(); }
  } finally { await client.query('ROLLBACK'); client.release(); await live.close(); }
});
test('SSE limita conexões e encerra sessões expiradas ou contas desativadas', async () => {
  const lives = await Promise.all(Array.from({ length: 3 }, () => stream(ana)));
  try {
    const limit = await fetch(`${base}/api/events`, { headers: { Cookie: ana.cookie } }); assert.equal(limit.status, 429);
  } finally { await Promise.all(lives.map(item => item.close())); }
  const expired = await login('ana@example.com'); const first = await stream(expired);
  try {
    await database.pool.query("UPDATE sessions SET expire=NOW()-INTERVAL '1 minute' WHERE sess->>'userId'=$1", [ana.id]);
    await app.locals.realtime.checkSessions(); await first.next('session-ended');
  } finally { await first.close(); }
  ana = await login('ana@example.com'); const second = await stream(ana);
  try {
    await admin.agent.patch(`/api/users/${ana.id}`).set('x-csrf-token', admin.csrf).send({ active: false }).expect(200);
    await second.next('session-ended'); await ana.agent.get('/api/orders').expect(401);
  } finally { await second.close(); await database.pool.query('UPDATE users SET active=TRUE WHERE id=$1', [ana.id]); ana = await login('ana@example.com'); }
});
test('consultas são limitadas por usuário, independentemente do IP', async () => {
  const second = createApp(database.pool, testConfig(database.url), async () => {});
  try {
    for (let index = 0; index < 120; index++) await request(second).get('/api/orders').set('Cookie', bruno.cookie).expect(200);
    const limit = await request(second).get('/api/orders').set('Cookie', bruno.cookie).expect(429);
    assert.ok(Number(limit.headers['retry-after']) > 0);
    await request(second).get('/api/orders').set('Cookie', carlos.cookie).expect(200);
  } finally { await second.locals.realtime.close(); second.locals.sessionStore.close(); }
});
test('migration aditiva preserva registros antigos extensos e é idempotente', async () => {
  await database.pool.query('CREATE SCHEMA legacy_migration');
  const legacy = new Pool({ connectionString: database.url, options: '-c search_path=legacy_migration', max: 1 });
  try {
    await legacy.query(await readFile('server/migrations/001_initial.sql', 'utf8'));
    await legacy.query(`CREATE TABLE schema_migrations(name TEXT PRIMARY KEY,applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()); INSERT INTO schema_migrations(name) VALUES ('001_initial.sql')`);
    const user = (await legacy.query(`INSERT INTO users(name,email,password_hash,role) VALUES ('Legado','legacy@example.com','original_hash','REQUESTER') RETURNING id`)).rows[0];
    const order = (await legacy.query(`INSERT INTO orders(requester_id,requester_name,requester_email,title,description) VALUES ($1,'Legado','legacy@example.com',$2,$3) RETURNING *`, [user.id, 'a'.repeat(200), 'b'.repeat(12000)])).rows[0];
    await migrate(legacy); await migrate(legacy);
    const after = (await legacy.query('SELECT * FROM orders WHERE id=$1', [order.id])).rows[0];
    assert.deepEqual(after, order);
    assert.equal((await legacy.query('SELECT password_hash FROM users WHERE id=$1', [user.id])).rows[0].password_hash, 'original_hash');
    assert.equal((await legacy.query('SELECT count(*) FROM schema_migrations')).rows[0].count, '2');
  } finally { await legacy.end(); }
});
