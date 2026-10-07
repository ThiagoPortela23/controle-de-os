import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react';
import type { Order } from './types';

export const roles = { REQUESTER: 'Solicitante', TECHNICIAN: 'Técnico', ADMIN: 'Administrador' };
export const acceptanceLabels = { NOT_REQUESTED: 'Não solicitado', PENDING: 'Aceite pendente', CONFIRMED: 'Aceite confirmado', REJECTED: 'Aceite recusado' };
export function date(value: string | null, withTime = true) {
  return value ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', ...(withTime ? { timeStyle: 'short' as const } : {}) }).format(new Date(value)) : '—';
}
export function status(order: Order) {
  return order.status === 'OPEN' ? 'Aberto' : order.status === 'ASSIGNED' ? `Atribuído a ${order.technician_name}` : `Resolvido por ${order.resolved_by_name}`;
}
export function Badge({ order, acceptance = false }: { order: Order; acceptance?: boolean }) {
  const state = acceptance ? order.acceptance : order.status;
  return <span className={`badge badge-${state.toLowerCase()}`}><i />{acceptance ? acceptanceLabels[order.acceptance] : status(order)}</span>;
}
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  const id = useId();
  const input = isValidElement(children)
    ? cloneElement(children as ReactElement<{ id: string; 'aria-describedby'?: string }>, { id, 'aria-describedby': hint ? `${id}-hint` : undefined })
    : children;
  return <div className="field"><label htmlFor={id}>{label}</label>{input}{hint && <small id={`${id}-hint`}>{hint}</small>}</div>;
}
export function Notice({ message, error = false }: { message: string; error?: boolean }) {
  return message ? <div role={error ? 'alert' : 'status'} className={`notice ${error ? 'notice-error' : ''}`}>{message}</div> : null;
}
export function Loading() { return <div className="empty-state" role="status">Carregando…</div>; }
export function Icon({ name, size = 20 }: { name: 'grid' | 'file' | 'users' | 'plus' | 'download' | 'arrow' | 'logout' | 'check' | 'search'; size?: number }) {
  const paths = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M8 13h8M8 17h5" /></>,
    users: <><circle cx="9" cy="7" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3M17 4a3 3 0 0 1 0 6M21 21v-3a6 6 0 0 0-4-5.7" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" /></>,
    arrow: <path d="M19 12H5m6-6-6 6 6 6" />,
    logout: <><path d="M9 21H4V3h5M9 12h12m-5-5 5 5-5 5" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    search: <><circle cx="10" cy="10" r="6" /><path d="m15 15 6 6" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
