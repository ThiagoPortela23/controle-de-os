import { cloneElement, isValidElement, useEffect, useId, useRef, useState, type InputHTMLAttributes, type ReactElement, type ReactNode } from 'react';
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
export function PasswordInput({ visibilityLabel = 'senha', ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { visibilityLabel?: string }) {
  const [visible, setVisible] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const form = input.current?.form;
    const hide = () => setVisible(false);
    form?.addEventListener('reset', hide);
    return () => form?.removeEventListener('reset', hide);
  }, []);
  const label = `${visible ? 'Ocultar' : 'Mostrar'} ${visibilityLabel}`;
  return <div className="password-input">
    <input {...props} ref={input} type={visible ? 'text' : 'password'} />
    <button type="button" className="password-toggle" disabled={props.disabled} aria-label={label} title={label}
      aria-pressed={visible} aria-controls={props.id} onClick={() => setVisible(value => !value)}>
      <Icon name={visible ? 'eye-off' : 'eye'} size={20} />
    </button>
  </div>;
}
export function Notice({ message, error = false }: { message: string; error?: boolean }) {
  return message ? <div role={error ? 'alert' : 'status'} className={`notice ${error ? 'notice-error' : ''}`}>{message}</div> : null;
}
export function Loading() { return <div className="empty-state" role="status">Carregando…</div>; }
export function Brand() {
  return <span className="brand"><img className="brand-mark" src="/logo.svg" alt="" /><span>Central de<small className="brand-name">Serviços</small></span></span>;
}
export function Icon({ name, size = 20 }: { name: 'grid' | 'file' | 'users' | 'plus' | 'download' | 'arrow' | 'logout' | 'check' | 'search' | 'moon' | 'sun' | 'bell' | 'eye' | 'eye-off'; size?: number }) {
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
    moon: <path d="M20 15.5A8.5 8.5 0 0 1 8.5 4a8.5 8.5 0 1 0 11.5 11.5Z" />,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></>,
    eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>,
    'eye-off': <><path d="m3 3 18 18M10.5 5.1A12 12 0 0 1 12 5c6.5 0 10 7 10 7a18 18 0 0 1-3 3.8M6.1 6.1A20 20 0 0 0 2 12s3.5 7 10 7a12 12 0 0 0 5.9-1.9M9.9 9.9a3 3 0 0 0 4.2 4.2" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
