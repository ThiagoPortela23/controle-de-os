import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { User } from './types';
import { Icon, roles } from './ui';

export function UserMenu({ user, leaving, onLogout }: { user: User; leaving: boolean; onLogout: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const openRef = useRef(open); openRef.current = open;
  const root = useRef<HTMLDivElement>(null); const trigger = useRef<HTMLButtonElement>(null);
  const lastItem = useRef(false); const id = useId(); const location = useLocation();
  const close = useCallback((restoreFocus = true) => {
    setOpen(false); if (restoreFocus) trigger.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => { if (openRef.current) close(); }, [location.key, close]);
  useEffect(() => {
    if (!open) return;
    const items = root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]');
    items?.[lastItem.current ? items.length - 1 : 0]?.focus();
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) close(); };
    const focus = (event: FocusEvent) => { if (!root.current?.contains(event.target as Node)) close(false); };
    const escape = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); close(); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('focusin', focus); document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', focus); document.removeEventListener('keydown', escape);
    };
  }, [open, close]);
  function keys(event: KeyboardEvent<HTMLDivElement>) {
    const items = [...(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const current = items.indexOf(document.activeElement as HTMLElement);
    let next: number | undefined;
    if (event.key === 'ArrowDown') next = (current + 1) % items.length;
    if (event.key === 'ArrowUp') next = (current - 1 + items.length) % items.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = items.length - 1;
    if (next !== undefined) { event.preventDefault(); items[next]?.focus(); }
    if (event.key === ' ' && event.target instanceof HTMLAnchorElement) { event.preventDefault(); event.target.click(); }
  }
  return <div className="user-menu" ref={root}>
    <button ref={trigger} id={`${id}-trigger`} type="button" className="user-menu-trigger" aria-label="Menu do usuário"
      title={`${user.name} · ${roles[user.role]}`} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? `${id}-menu` : undefined}
      aria-busy={leaving} disabled={leaving} onClick={() => { lastItem.current = false; setOpen(value => !value); }}
      onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault(); lastItem.current = event.key === 'ArrowUp'; setOpen(true);
      } }}><Icon name="user" size={22} /></button>
    {open && <div id={`${id}-menu`} className="user-menu-popover" role="menu" aria-labelledby={`${id}-trigger`} onKeyDown={keys}>
      <div className="user-menu-identity" role="presentation"><strong>{user.name}</strong><span>{roles[user.role]}</span></div>
      <Link to="/senha" role="menuitem" tabIndex={-1} onClick={() => close()}><Icon name="key" size={18} />Alterar senha</Link>
      <button type="button" role="menuitem" tabIndex={-1} disabled={leaving} onClick={() => { close(); void onLogout(); }}>
        <Icon name="logout" size={18} />{leaving ? 'Saindo…' : 'Sair'}
      </button>
    </div>}
  </div>;
}
