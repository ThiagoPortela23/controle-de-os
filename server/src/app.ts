import express, { type ErrorRequestHandler } from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { z, ZodError } from 'zod';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import type { Pool } from 'pg';
import type { Config } from './config.js';
import type { User } from './types.js';
import { Orders } from './orders.js';
import { csrf, auth, role, HttpError, requireCondition, hashPassword, verifyPassword, newToken, publicUser } from './security.js';
import { deliver, type Mailer } from './email.js';
import { orderPdf } from './pdf.js';

const password = z.string().min(10, 'Use pelo menos 10 caracteres.').max(128);
const uuid = z.uuid();
const token = z.string().regex(/^[a-f0-9]{64}$/);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}, 'Data inválida.');
const saveSession = (req: express.Request) => new Promise<void>((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));

export function createApp(pool: Pool, config: Config, mailer: Mailer) {
  const app = express();
  const orders = new Orders(pool);
  if (config.NODE_ENV === 'production') app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: { directives: {
    'img-src': ["'self'", 'data:'],
    'upgrade-insecure-requests': config.NODE_ENV === 'production' ? [] : null,
  } } }));
  app.use(express.json({ limit: '128kb' }));
  const PgStore = connectPgSimple(session);
  const store = new PgStore({ pool, tableName: 'sessions', pruneSessionInterval: config.NODE_ENV === 'test' ? false : 900 });
  app.locals.sessionStore = store;
  app.use('/api', session({
    store, secret: config.SESSION_SECRET, name: 'os.sid', resave: false, saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'strict', secure: config.NODE_ENV === 'production', maxAge: 8 * 60 * 60 * 1000 },
  }));
  app.get('/api/health', async (_req, res) => { await pool.query('SELECT 1'); res.json({ status: 'ok' }); });
  const publicLimiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { message: 'Muitas tentativas. Aguarde um minuto.' } });
  app.use('/api/confirmations', publicLimiter, (_req, res, next) => {
    res.set('Cache-Control', 'no-store'); res.set('Referrer-Policy', 'no-referrer'); next();
  });
  app.get('/api/confirmations/:token', async (req, res) => {
    res.json(await orders.publicConfirmation(token.parse(req.params.token)));
  });
  app.post('/api/confirmations/:token', async (req, res) => {
    const input = z.object({ response: z.enum(['CONFIRMED', 'REJECTED']), reason: z.string().trim().max(5000).optional() })
      .refine(value => value.response !== 'REJECTED' || Boolean(value.reason), 'Informe o motivo da recusa.').parse(req.body);
    await orders.respond(token.parse(req.params.token), input.response, input.reason);
    res.json({ message: input.response === 'CONFIRMED' ? 'Aceite registrado. Obrigado pela confirmação.' : 'Recusa registrada. A OS foi reaberta.' });
  });
  app.get('/api/auth/csrf', (req, res) => {
    req.session.csrf ||= newToken(); res.set('Cache-Control', 'no-store').json({ csrfToken: req.session.csrf });
  });
  app.use('/api', csrf(new URL(config.APP_PUBLIC_URL).origin));
  const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { message: 'Muitas tentativas de login. Aguarde 15 minutos.' } });
  app.post('/api/auth/login', loginLimiter, async (req, res) => {
    const input = z.object({ email: z.email().transform(value => value.toLowerCase()), password: z.string().min(1).max(128) }).parse(req.body);
    const user = (await pool.query<User & { password_hash: string }>('SELECT * FROM users WHERE email=$1', [input.email])).rows[0];
    requireCondition(user && user.active && await verifyPassword(input.password, user.password_hash), 401, 'Email ou senha inválidos.');
    await new Promise<void>((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
    req.session.userId = user.id; req.session.csrf = newToken();
    await saveSession(req);
    res.json({ user: publicUser(user), csrfToken: req.session.csrf });
  });
  app.use('/api', auth(pool), (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.get('/api/auth/me', (req, res) => res.json({ user: publicUser(req.user!), csrfToken: req.session.csrf }));
  app.post('/api/auth/logout', async (req, res) => {
    await new Promise<void>((resolve, reject) => req.session.destroy(error => error ? reject(error) : resolve()));
    res.clearCookie('os.sid', { httpOnly: true, sameSite: 'strict', secure: config.NODE_ENV === 'production' }).json({ message: 'Sessão encerrada.' });
  });
  app.post('/api/auth/password', async (req, res) => {
    const input = z.object({ currentPassword: z.string().min(1).max(128), newPassword: password })
      .refine(value => value.currentPassword !== value.newPassword, 'A nova senha precisa ser diferente.').parse(req.body);
    const stored = (await pool.query('SELECT password_hash FROM users WHERE id=$1', [req.user!.id])).rows[0];
    requireCondition(await verifyPassword(input.currentPassword, stored.password_hash), 400, 'Senha atual incorreta.');
    await pool.query('UPDATE users SET password_hash=$2,must_change_password=FALSE WHERE id=$1', [req.user!.id, await hashPassword(input.newPassword)]);
    await pool.query("DELETE FROM sessions WHERE sess->>'userId'=$1 AND sid<>$2", [req.user!.id, req.sessionID]);
    req.session.csrf = newToken(); await saveSession(req);
    res.json({ user: publicUser({ ...req.user!, must_change_password: false }), csrfToken: req.session.csrf });
  });
  app.get('/api/users', role('ADMIN'), async (_req, res) => {
    const users = (await pool.query<User>('SELECT * FROM users ORDER BY created_at DESC')).rows;
    res.json(users.map(publicUser));
  });
  app.get('/api/technicians', role('ADMIN'), async (_req, res) => {
    res.json((await pool.query<User>("SELECT * FROM users WHERE role='TECHNICIAN' AND active=TRUE ORDER BY name")).rows.map(publicUser));
  });
  app.post('/api/users', role('ADMIN'), async (req, res) => {
    const input = z.object({ name: z.string().trim().min(2).max(120), email: z.email().transform(value => value.toLowerCase()),
      role: z.enum(['REQUESTER', 'TECHNICIAN', 'ADMIN']), temporaryPassword: password }).parse(req.body);
    const user = (await pool.query<User>('INSERT INTO users(name,email,role,password_hash) VALUES ($1,$2,$3,$4) RETURNING *',
      [input.name, input.email, input.role, await hashPassword(input.temporaryPassword)])).rows[0];
    res.status(201).json(publicUser(user));
  });
  app.patch('/api/users/:id', role('ADMIN'), async (req, res) => {
    const id = uuid.parse(req.params.id);
    const input = z.object({ active: z.boolean().optional(), temporaryPassword: password.optional() })
      .refine(value => value.active !== undefined || value.temporaryPassword, 'Informe a alteração.').parse(req.body);
    requireCondition(id !== req.user!.id, 400, 'Use a troca de senha da sua conta. Não é possível desativar a própria conta.');
    const user = (await pool.query<User>(
      `UPDATE users SET active=COALESCE($2,active),password_hash=COALESCE($3,password_hash),
       must_change_password=CASE WHEN $3::text IS NOT NULL THEN TRUE ELSE must_change_password END WHERE id=$1 RETURNING *`,
      [id, input.active ?? null, input.temporaryPassword ? await hashPassword(input.temporaryPassword) : null],
    )).rows[0];
    requireCondition(user, 404, 'Usuário não encontrado.');
    await pool.query("DELETE FROM sessions WHERE sess->>'userId'=$1", [id]);
    res.json(publicUser(user));
  });
  app.get('/api/orders', async (req, res) => {
    const input = z.object({ from: date.optional(), to: date.optional(), requester: z.string().trim().max(120).optional(),
      number: z.coerce.number().int().min(1).max(2147483647).optional(), page: z.coerce.number().int().min(1).max(1000000).default(1) })
      .refine(value => !value.from || !value.to || value.from <= value.to, 'A data inicial deve preceder a final.').parse(req.query);
    res.json(await orders.list(req.user!, input));
  });
  app.post('/api/orders', role('REQUESTER'), async (req, res) => {
    const input = z.object({ title: z.string().trim().min(3).max(200), description: z.string().trim().min(5).max(20000) }).parse(req.body);
    res.status(201).json(await orders.create(req.user!, input.title, input.description));
  });
  app.get('/api/orders/:id', async (req, res) => res.json(await orders.detail(req.user!, uuid.parse(req.params.id))));
  app.post('/api/orders/:id/assign', role('ADMIN'), async (req, res) => {
    const input = z.object({ technicianId: uuid }).parse(req.body);
    const id = uuid.parse(req.params.id);
    await orders.assign(req.user!, id, input.technicianId);
    res.json(await orders.detail(req.user!, id));
  });
  app.post('/api/orders/:id/resolve', role('TECHNICIAN'), async (req, res) => {
    const input = z.object({ solution: z.string().trim().min(5).max(20000) }).parse(req.body);
    const delivery = await orders.resolve(req.user!, uuid.parse(req.params.id), input.solution);
    res.json(await deliver(pool, mailer, delivery));
  });
  app.post('/api/orders/:id/resend', role('TECHNICIAN', 'ADMIN'), async (req, res) => {
    const delivery = await orders.resend(req.user!, uuid.parse(req.params.id));
    res.json(await deliver(pool, mailer, delivery));
  });
  app.get('/api/orders/:id/pdf', async (req, res) => {
    const order = await orders.detail(req.user!, uuid.parse(req.params.id));
    const pdf = await orderPdf(order);
    res.type('application/pdf').set('Content-Disposition', `attachment; filename="OS-${order.number}.pdf"`).send(pdf);
  });
  app.use('/api', (_req, res) => res.status(404).json({ message: 'Endpoint não encontrado.' }));
  const clientDirectory = resolve('dist/client');
  if (existsSync(clientDirectory)) {
    app.use(express.static(clientDirectory));
    app.get('/{*path}', (_req, res) => {
      res.set('Referrer-Policy', 'no-referrer'); res.sendFile(resolve(clientDirectory, 'index.html'));
    });
  }
  const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof ZodError) { res.status(400).json({ message: error.issues.map(issue => issue.message).join(' ') }); return; }
    if (error instanceof HttpError) { res.status(error.status).json({ message: error.message }); return; }
    if (error.code === '23505') { res.status(409).json({ message: 'Este email já está cadastrado.' }); return; }
    if (error.type === 'entity.too.large') { res.status(413).json({ message: 'Conteúdo muito grande.' }); return; }
    if (error instanceof SyntaxError && 'body' in error) { res.status(400).json({ message: 'JSON inválido.' }); return; }
    // Log only the error class/code; never log passwords, tokens or database connection strings.
    console.error('Falha interna:', error.code || error.name || 'UnknownError');
    res.status(500).json({ message: 'Falha interna. Tente novamente.' });
  };
  app.use(errorHandler);
  return app;
}
