import type { Pool, PoolClient } from 'pg';
import { transaction } from './db.js';
import { canReadOrder, requireCondition, newToken, tokenHash, HttpError } from './security.js';
import type { User, Order, Confirmation, Delivery, OrderEvent } from './types.js';

async function lockedOrder(client: PoolClient, id: string) {
  const order = (await client.query<Order>('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [id])).rows[0];
  requireCondition(order, 404, 'OS não encontrada.');
  return order;
}
async function event(client: PoolClient, orderId: string, actor: Pick<User, 'id' | 'name'>, kind: string, message: string) {
  await client.query('INSERT INTO order_events(order_id,actor_id,actor_name,kind,message) VALUES ($1,$2,$3,$4,$5)', [orderId, actor.id, actor.name, kind, message]);
}
async function issueConfirmation(client: PoolClient, order: Order): Promise<Delivery> {
  await client.query('UPDATE confirmations SET invalidated_at=NOW() WHERE order_id=$1 AND invalidated_at IS NULL AND responded_at IS NULL', [order.id]);
  const token = newToken();
  const confirmation = (await client.query<Confirmation>(
    `INSERT INTO confirmations(order_id,version,token_hash,requester_name,requester_email,expires_at)
     VALUES ($1,$2,$3,$4,$5,NOW()+INTERVAL '72 hours') RETURNING *`,
    [order.id, order.resolution_version, tokenHash(token), order.requester_name, order.requester_email],
  )).rows[0];
  return { confirmation, order, token };
}
function validConfirmation(confirmation: Confirmation | undefined, order: Order) {
  requireCondition(confirmation && !confirmation.invalidated_at && !confirmation.responded_at
    && confirmation.expires_at.getTime() > Date.now() && order.status === 'RESOLVED'
    && order.acceptance === 'PENDING' && confirmation.version === order.resolution_version,
  410, 'Este link expirou ou já foi utilizado. Peça um novo email à equipe.');
}
export interface OrderFilters { from?: string; to?: string; requester?: string; number?: number; page: number }
export class Orders {
  constructor(private pool: Pool) {}
  async create(user: User, title: string, description: string) {
    return transaction(this.pool, async client => {
      const requester = await client.query('SELECT id FROM users WHERE id=$1 AND active=TRUE FOR UPDATE', [user.id]);
      requireCondition(requester.rowCount, 401, 'Sessão inválida. Entre novamente.');
      const quota = (await client.query<{ total: string; retry_after: number }>(
        `SELECT COUNT(*) AS total,
         GREATEST(1, CEIL(EXTRACT(EPOCH FROM (MIN(created_at) + INTERVAL '60 minutes' - NOW()))))::int AS retry_after
         FROM orders WHERE requester_id=$1 AND created_at > NOW() - INTERVAL '60 minutes'`, [user.id],
      )).rows[0];
      if (Number(quota.total) >= 10) throw new HttpError(429,
        'Você atingiu o limite de 10 chamados em 60 minutos. Aguarde antes de abrir outro.', quota.retry_after);
      const order = (await client.query<Order>(
        'INSERT INTO orders(requester_id,requester_name,requester_email,title,description) VALUES ($1,$2,$3,$4,$5) RETURNING *',
        [user.id, user.name, user.email, title, description],
      )).rows[0];
      await event(client, order.id, user, 'OPENED', 'OS aberta.');
      return order;
    });
  }
  async list(user: User, filters: OrderFilters) {
    const params: unknown[] = [];
    const where: string[] = [];
    const add = (sql: string, value: unknown) => { params.push(value); where.push(sql.replace('?', `$${params.length}`)); };
    if (user.role === 'REQUESTER') add('o.requester_id=?', user.id);
    if (user.role === 'TECHNICIAN') add('o.technician_id=?', user.id);
    if (filters.from) add("o.created_at >= (?::date::timestamp AT TIME ZONE 'America/Sao_Paulo')", filters.from);
    if (filters.to) add("o.created_at < ((?::date + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo')", filters.to);
    if (filters.requester) add("o.requester_name ILIKE '%' || ? || '%'", filters.requester.replace(/[\\%_]/g, '\\$&'));
    if (filters.number) add('o.number=?', filters.number);
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    return transaction(this.pool, async client => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      const total = Number((await client.query(`SELECT COUNT(*) FROM orders o ${clause}`, params)).rows[0].count);
      const data = await client.query(
        `SELECT o.* FROM orders o ${clause} ORDER BY o.created_at DESC,o.number DESC LIMIT 20 OFFSET $${params.length + 1}`,
        [...params, (filters.page - 1) * 20],
      );
      return { items: data.rows as Order[], total, page: filters.page, pageSize: 20 };
    });
  }
  async detail(user: User, id: string) {
    return transaction(this.pool, async client => {
      const order = (await client.query<Order>('SELECT * FROM orders WHERE id=$1 FOR SHARE', [id])).rows[0];
      requireCondition(order && canReadOrder(user, order), 404, 'OS não encontrada.');
      const events = (await client.query<OrderEvent>('SELECT id,actor_name,kind,message,created_at FROM order_events WHERE order_id=$1 ORDER BY id', [id])).rows;
      const confirmations = (await client.query(
        `SELECT id,version,requester_name,expires_at,invalidated_at,responded_at,response,reason,email_status,created_at
         FROM confirmations WHERE order_id=$1 ORDER BY created_at DESC,id DESC`, [id],
      )).rows;
      return { ...order, events, confirmations };
    });
  }
  async assign(user: User, id: string, technicianId: string) {
    return transaction(this.pool, async client => {
      const order = await lockedOrder(client, id);
      requireCondition(order.status !== 'RESOLVED', 409, 'Uma OS resolvida não pode ser atribuída.');
      const technician = (await client.query<User>("SELECT * FROM users WHERE id=$1 AND role='TECHNICIAN' AND active=TRUE FOR SHARE", [technicianId])).rows[0];
      requireCondition(technician, 400, 'Selecione um técnico ativo.');
      await client.query("UPDATE orders SET status='ASSIGNED',technician_id=$2,technician_name=$3,updated_at=NOW() WHERE id=$1", [id, technician.id, technician.name]);
      await event(client, id, user, 'ASSIGNED', `Atribuído a ${technician.name}.`);
    });
  }
  async resolve(user: User, id: string, solution: string) {
    return transaction(this.pool, async client => {
      const order = await lockedOrder(client, id);
      requireCondition(order.technician_id === user.id, 403, 'Somente o técnico atribuído pode resolver esta OS.');
      requireCondition(order.status === 'ASSIGNED', 409, 'A OS precisa estar atribuída para ser resolvida.');
      const resolved = (await client.query<Order>(
        `UPDATE orders SET status='RESOLVED',solution=$2,resolved_by_id=$3,resolved_by_name=$4,resolved_at=NOW(),
         resolution_version=resolution_version+1,acceptance='PENDING',updated_at=NOW() WHERE id=$1 RETURNING *`,
        [id, solution, user.id, user.name],
      )).rows[0];
      await event(client, id, user, 'RESOLVED', `Resolvido por ${user.name}. Solução: ${solution}`);
      return issueConfirmation(client, resolved);
    });
  }
  async resend(user: User, id: string) {
    return transaction(this.pool, async client => {
      const order = await lockedOrder(client, id);
      requireCondition(user.role === 'ADMIN' || (user.role === 'TECHNICIAN' && order.technician_id === user.id), 403, 'Acesso não permitido.');
      requireCondition(order.status === 'RESOLVED' && order.acceptance === 'PENDING', 409, 'Não há aceite pendente para esta OS.');
      await event(client, id, user, 'EMAIL_REISSUED', 'Novo link de aceite solicitado; link anterior invalidado.');
      return issueConfirmation(client, order);
    });
  }
  async publicConfirmation(token: string) {
    return transaction(this.pool, async client => {
      const confirmation = (await client.query<Confirmation>('SELECT * FROM confirmations WHERE token_hash=$1', [tokenHash(token)])).rows[0];
      requireCondition(confirmation, 410, 'Este link expirou ou já foi utilizado. Peça um novo email à equipe.');
      const order = (await client.query<Order>('SELECT * FROM orders WHERE id=$1 FOR SHARE', [confirmation.order_id])).rows[0];
      // Re-read after the order lock: resends may have invalidated the first read.
      const current = (await client.query<Confirmation>('SELECT * FROM confirmations WHERE id=$1', [confirmation.id])).rows[0];
      validConfirmation(current, order);
      return { number: order.number, title: order.title, description: order.description, solution: order.solution,
        technician: order.resolved_by_name, requester: current.requester_name, resolvedAt: order.resolved_at, expiresAt: current.expires_at };
    });
  }
  async respond(token: string, response: 'CONFIRMED' | 'REJECTED', reason?: string) {
    await transaction(this.pool, async client => {
      const initial = (await client.query<Confirmation>('SELECT * FROM confirmations WHERE token_hash=$1', [tokenHash(token)])).rows[0];
      requireCondition(initial, 410, 'Este link expirou ou já foi utilizado. Peça um novo email à equipe.');
      const order = await lockedOrder(client, initial.order_id);
      const confirmation = (await client.query<Confirmation>('SELECT * FROM confirmations WHERE id=$1 FOR UPDATE', [initial.id])).rows[0];
      validConfirmation(confirmation, order);
      await client.query('UPDATE confirmations SET responded_at=NOW(),response=$2,reason=$3 WHERE id=$1', [confirmation.id, response, reason || null]);
      if (response === 'CONFIRMED') {
        await client.query("UPDATE orders SET acceptance='CONFIRMED',updated_at=NOW() WHERE id=$1", [order.id]);
      } else {
        await client.query(
          `UPDATE orders SET status='OPEN',acceptance='REJECTED',technician_id=NULL,technician_name=NULL,
           resolved_by_id=NULL,resolved_by_name=NULL,solution=NULL,resolved_at=NULL,updated_at=NOW() WHERE id=$1`, [order.id],
        );
        await client.query('UPDATE confirmations SET invalidated_at=NOW() WHERE order_id=$1 AND responded_at IS NULL AND invalidated_at IS NULL', [order.id]);
      }
      await event(client, order.id, { id: order.requester_id, name: confirmation.requester_name }, response,
        response === 'CONFIRMED' ? `Aceite confirmado por link de email para o atendimento ${confirmation.version}.`
          : `Aceite recusado; OS reaberta. Motivo: ${reason}`);
    });
  }
}
