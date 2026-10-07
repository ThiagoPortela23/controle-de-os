import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import type { RequestHandler } from 'express';
import type { Pool } from 'pg';
import type { User, Order, Role } from './types.js';

const scrypt = promisify(scryptCallback);
export class HttpError extends Error { constructor(public status: number, message: string, public retryAfter?: number) { super(message); } }
export function requireCondition(condition: unknown, status: number, message: string): asserts condition {
  if (!condition) throw new HttpError(status, message);
}
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 64) as Buffer;
  return `scrypt:${salt}:${key.toString('hex')}`;
}
export async function verifyPassword(password: string, stored: string) {
  const [algorithm, salt, hash] = stored.split(':');
  if (algorithm !== 'scrypt' || !salt || !hash) return false;
  const key = await scrypt(password, salt, 64) as Buffer;
  const expected = Buffer.from(hash, 'hex');
  return expected.length === key.length && timingSafeEqual(key, expected);
}
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
export const newToken = () => randomBytes(32).toString('hex');
export const publicUser = (user: User) => ({ id: user.id, name: user.name, email: user.email, role: user.role, active: user.active, must_change_password: user.must_change_password });
export function auth(pool: Pool): RequestHandler {
  return async (req, _res, next) => {
    try {
      requireCondition(req.session.userId, 401, 'Entre para continuar.');
      const user = (await pool.query<User>('SELECT * FROM users WHERE id=$1 AND active=TRUE', [req.session.userId])).rows[0];
      requireCondition(user, 401, 'Sessão inválida. Entre novamente.');
      req.user = user;
      if (user.must_change_password && !['/auth/me', '/auth/password', '/auth/logout'].includes(req.path)) {
        throw new HttpError(403, 'Troque a senha inicial para continuar.');
      }
      next();
    } catch (error) { next(error); }
  };
}
export function role(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role)) return next(new HttpError(403, 'Acesso não permitido.'));
    next();
  };
}
export function canReadOrder(user: User, order: Order) {
  return user.role === 'ADMIN' || (user.role === 'REQUESTER' && order.requester_id === user.id)
    || (user.role === 'TECHNICIAN' && order.technician_id === user.id);
}
export function csrf(origin: string): RequestHandler {
  return (req, _res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (req.headers.origin && req.headers.origin !== origin) return next(new HttpError(403, 'Origem não permitida.'));
    const received = req.get('x-csrf-token');
    if (!received || !req.session.csrf || received !== req.session.csrf) return next(new HttpError(403, 'Recarregue a página e tente novamente.'));
    next();
  };
}
