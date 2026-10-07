import type { Request, Response } from 'express';
import type { Pool, PoolClient, Notification } from 'pg';
import type { User } from './types.js';
import { HttpError } from './security.js';

interface Change {
  orderId: string; number: number; kind: 'opened' | 'changed';
  requesterId: string; technicianId: string | null; previousTechnicianId: string | null;
}
interface Stream { response: Response; user: User; sessionId: string }

export class Realtime {
  private streams = new Set<Stream>();
  private client?: PoolClient;
  private starting?: Promise<void>;
  private closed = false;
  private checking = false;
  private heartbeat: ReturnType<typeof setInterval>;

  constructor(private pool: Pool) {
    this.heartbeat = setInterval(() => { void this.checkSessions(); }, 30_000);
    this.heartbeat.unref();
  }
  private async listen() {
    if (this.closed) throw new HttpError(503, 'Atualização automática indisponível.');
    if (this.client) return;
    if (!this.starting) this.starting = (async () => {
      const client = await this.pool.connect();
      if (this.closed) { client.release(); throw new HttpError(503, 'Aplicação encerrando.'); }
      try { await client.query('LISTEN os_changes'); }
      catch (error) { client.release(true); throw error; }
      if (this.closed) { client.release(true); return; }
      this.client = client;
      client.on('notification', notification => this.broadcast(notification));
      client.on('error', () => {
        if (this.client !== client) return;
        this.client = undefined; client.release(true);
        // End streams so EventSource reconnects and obtains a fresh snapshot.
        for (const stream of this.streams) stream.response.end();
      });
    })().finally(() => { this.starting = undefined; });
    await this.starting;
  }
  async subscribe(request: Request, response: Response) {
    if ([...this.streams].filter(stream => stream.user.id === request.user!.id).length >= 3) {
      throw new HttpError(429, 'Limite de três telas com atualização automática por usuário.', 30);
    }
    await this.listen();
    if (response.destroyed || this.closed) return;
    // Recheck after LISTEN: simultaneous connections can share the pending setup.
    if ([...this.streams].filter(stream => stream.user.id === request.user!.id).length >= 3) {
      throw new HttpError(429, 'Limite de três telas com atualização automática por usuário.', 30);
    }
    response.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    response.flushHeaders();
    const stream = { response, user: request.user!, sessionId: request.sessionID };
    this.streams.add(stream);
    response.on('close', () => { this.streams.delete(stream); });
    response.write('retry: 3000\nevent: ready\ndata: {}\n\n');
  }
  private broadcast(notification: Notification) {
    if (notification.channel !== 'os_changes' || !notification.payload) return;
    let change: Change;
    try { change = JSON.parse(notification.payload) as Change; } catch { return; }
    for (const stream of this.streams) {
      const user = stream.user;
      const allowed = user.role === 'ADMIN' || (user.role === 'REQUESTER' && user.id === change.requesterId)
        || (user.role === 'TECHNICIAN' && [change.technicianId, change.previousTechnicianId].includes(user.id));
      if (!allowed) continue;
      const data = user.role === 'ADMIN' ? { orderId: change.orderId, number: change.number, kind: change.kind }
        : { orderId: change.orderId, kind: 'changed' };
      if (!stream.response.write(`event: change\ndata: ${JSON.stringify(data)}\n\n`)) stream.response.end();
    }
  }
  async checkSessions() {
    if (!this.streams.size || this.checking || this.closed) return;
    this.checking = true;
    try {
      const sessions = (await this.pool.query<{ sid: string; role: string }>(
        `SELECT s.sid,u.role FROM sessions s JOIN users u ON u.id::text=s.sess->>'userId'
         WHERE s.sid=ANY($1::text[]) AND s.expire>NOW() AND u.active=TRUE AND u.must_change_password=FALSE`,
        [[...new Set([...this.streams].map(stream => stream.sessionId))]],
      )).rows;
      const valid = new Map(sessions.map(session => [session.sid, session.role]));
      for (const stream of this.streams) {
        if (valid.get(stream.sessionId) !== stream.user.role) {
          stream.response.write('event: session-ended\ndata: {}\n\n'); stream.response.end();
        } else if (!stream.response.write(': heartbeat\n\n')) stream.response.end();
      }
    } catch {
      for (const stream of this.streams) stream.response.end();
    } finally { this.checking = false; }
  }
  disconnectSession(sessionId: string) {
    for (const stream of this.streams) if (stream.sessionId === sessionId) stream.response.end();
  }
  disconnectUser(userId: string, exceptSession?: string) {
    for (const stream of this.streams) if (stream.user.id === userId && stream.sessionId !== exceptSession) {
      stream.response.write('event: session-ended\ndata: {}\n\n'); stream.response.end();
    }
  }
  async close() {
    this.closed = true; clearInterval(this.heartbeat);
    for (const stream of this.streams) stream.response.end();
    this.streams.clear();
    await this.starting?.catch(() => {});
    this.client?.release(true); this.client = undefined;
  }
}
