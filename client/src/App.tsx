import { createContext, useCallback, useContext, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { api, json, setCsrf } from './api';
import type { User } from './types';
import { Brand, Field, Icon, Loading, Notice, PasswordInput, date, roles } from './ui';
import { OrderList, NewOrder, OrderDetail } from './Orders';
import { Users } from './Users';
import { Dashboard } from './Dashboard';
import { LiveProvider, useLive } from './Live';
import { ThemeScope, ThemeToggle } from './Theme';
import { UserMenu } from './UserMenu';

const Auth = createContext<{ user: User; update: (user: User | null) => void } | null>(null);
export function useAuth() { return useContext(Auth)!; }
type Session = { user: User; csrfToken: string };
const messageOf = (error: unknown) => error instanceof Error ? error.message : 'Falha inesperada.';

export function App() {
  // Public acceptance pages never require login or depend on an existing session.
  return <Routes><Route path="/confirmacao/:token" element={<Confirmation />} /><Route path="*" element={<PrivateApp />} /></Routes>;
}
function PrivateApp() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const expire = useCallback(() => { setCsrf(''); setUser(null); }, []);
  useEffect(() => { window.addEventListener('session-expired', expire); return () => window.removeEventListener('session-expired', expire); }, [expire]);
  useEffect(() => { api<Session>('/auth/me').then(data => { setUser(data.user); setCsrf(data.csrfToken); }).catch(() => {}).finally(() => setLoading(false)); }, []);
  if (loading) return <Loading />;
  if (!user) return <Login onLogin={setUser} />;
  return <Auth.Provider value={{ user, update: setUser }}>
    <ThemeScope userId={user.id} /><LiveProvider user={user} onExpired={expire}><Shell>{user.must_change_password ? <Password mandatory /> : <Routes>
      <Route path="/" element={<Navigate to="/ordens" replace />} />
      <Route path="/ordens" element={<OrderList />} />
      <Route path="/dashboard" element={user.role === 'ADMIN' ? <Dashboard /> : <Navigate to="/ordens" replace />} />
      <Route path="/ordens/nova" element={user.role === 'REQUESTER' ? <NewOrder /> : <Navigate to="/" replace />} />
      <Route path="/ordens/:id" element={<OrderDetail />} />
      <Route path="/usuarios" element={user.role === 'ADMIN' ? <Users /> : <Navigate to="/" replace />} />
      <Route path="/senha" element={<Password />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>}</Shell></LiveProvider>
  </Auth.Provider>;
}
function Shell({ children }: { children: ReactNode }) {
  const { user, update } = useAuth();
  const live = useLive();
  const [error, setError] = useState('');
  const [leaving, setLeaving] = useState(false);
  async function logout() {
    if (leaving) return;
    setLeaving(true); setError('');
    try { await api('/auth/logout', { method: 'POST' }); setCsrf(''); update(null); }
    catch (error) { setError(messageOf(error)); }
    finally { setLeaving(false); }
  }
  return <div className="app-shell">
    <aside className="sidebar">
      <Link to="/ordens" aria-label="Central de Serviços"><Brand /></Link>
      <div className="nav-label">ÁREA DE TRABALHO</div>
      <nav><NavLink to="/ordens" end><Icon name="file" />Chamados</NavLink>{user.role === 'ADMIN' && <><NavLink to="/dashboard"><Icon name="grid" />Dashboard</NavLink><NavLink to="/usuarios"><Icon name="users" />Usuários</NavLink></>}</nav>
      <div className="sidebar-note"><span className={`live-dot ${live.connected ? '' : 'offline'}`} /><span role="status">{live.connected ? 'Atualização conectada' : user.must_change_password ? 'Troque a senha para continuar' : 'Reconectando atualização…'}</span><small>Do chamado ao aceite,<br />cada etapa no mesmo lugar.</small></div>
      <div className="sidebar-user"><div className="avatar">{user.name.slice(0, 1).toUpperCase()}</div><div><strong>{user.name}</strong><small>{roles[user.role]}</small></div></div>
    </aside>
    <div className="workspace">
      <header className="topbar"><span className="topbar-title">Central de Serviços</span><div className="topbar-actions">{user.role === 'ADMIN' && !user.must_change_password && <button className="preference-button" aria-pressed={live.soundEnabled} onClick={() => void live.toggleSound()}><Icon name="bell" size={17} /><span>{live.soundEnabled ? 'Desativar som' : 'Ativar som'}</span></button>}<ThemeToggle /><UserMenu user={user} leaving={leaving} onLogout={logout} /></div></header>
      <main>{live.newOrder !== null && <div className="live-notification" role="status">Novo chamado recebido: #{String(live.newOrder).padStart(4, '0')}.</div>}<Notice message={error || live.soundError} error />{children}</main>
      <footer className="workspace-footer">CENTRAL DE SERVIÇOS <span>Datas no horário de Brasília</span></footer>
    </div>
  </div>;
}
function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    const fields = new FormData(event.currentTarget);
    try {
      const result = await api<Session>('/auth/login', { method: 'POST', body: json({ email: fields.get('email'), password: fields.get('password') }) });
      setCsrf(result.csrfToken); onLogin(result.user); navigate('/');
    } catch (error) { setError(messageOf(error)); }
    finally { setBusy(false); }
  }
  return <div className="login-layout"><section className="login-story"><Brand /><div><span className="eyebrow">CADA ETAPA, DOCUMENTADA</span><h1>Atendimento simples.<br />Equipe conectada.</h1><p>Organize chamados, acompanhe a solução e registre a confirmação de quem recebeu o serviço.</p><div className="story-step"><span>01</span>Abertura do chamado</div><div className="story-step"><span>02</span>Atendimento pelo técnico</div><div className="story-step"><span>03</span>Aceite do solicitante</div></div><small>Uma central para todo o caminho.</small></section>
    <section className="login-form-area"><div className="public-controls"><ThemeToggle /></div><div className="login-card"><span className="eyebrow">CENTRAL DE SERVIÇOS</span><h2>Acesse sua conta</h2><p>Entre com o acesso fornecido pelo administrador.</p><Notice message={error} error /><form onSubmit={submit}><Field label="Email"><input name="email" type="email" autoComplete="username" required placeholder="voce@empresa.com" /></Field><Field label="Senha"><PasswordInput name="password" autoComplete="current-password" required maxLength={128} placeholder="Sua senha"  visibilityLabel="senha" /></Field><button className="button full" disabled={busy}>{busy ? 'Entrando…' : 'Entrar na central'}</button></form><div className="login-help">Precisa de acesso ou esqueceu a senha?<br />Entre em contato com o administrador.</div></div></section>
  </div>;
}
function Password({ mandatory = false }: { mandatory?: boolean }) {
  const { update } = useAuth();
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    const fields = new FormData(event.currentTarget);
    if (fields.get('newPassword') !== fields.get('repeat')) { setError('As senhas não coincidem.'); return; }
    setBusy(true);
    try {
      const result = await api<Session>('/auth/password', { method: 'POST', body: json({ currentPassword: fields.get('currentPassword'), newPassword: fields.get('newPassword') }) });
      setCsrf(result.csrfToken); update(result.user); navigate('/');
    } catch (error) { setError(messageOf(error)); }
    finally { setBusy(false); }
  }
  return <><div className="page-heading"><div><span className="eyebrow">SUA CONTA</span><h1>{mandatory ? 'Defina sua senha' : 'Trocar senha'}</h1><p>{mandatory ? 'Troque a senha temporária antes de acessar a central.' : 'Use uma senha diferente da atual, com pelo menos 10 caracteres.'}</p></div></div><section className="panel form-panel"><Notice message={error} error /><form onSubmit={submit}><Field label="Senha atual"><PasswordInput name="currentPassword" autoComplete="current-password" required maxLength={128}  visibilityLabel="senha atual" /></Field><Field label="Nova senha"><PasswordInput name="newPassword" autoComplete="new-password" required minLength={10} maxLength={128}  visibilityLabel="nova senha" /></Field><Field label="Repita a nova senha"><PasswordInput name="repeat" autoComplete="new-password" required minLength={10} maxLength={128}  visibilityLabel="repetição da senha" /></Field><button className="button" disabled={busy}>{busy ? 'Salvando…' : 'Salvar nova senha'}</button></form></section></>;
}
interface PublicConfirmation { number: number; title: string; description: string; solution: string; technician: string; requester: string; resolvedAt: string; expiresAt: string }
function Confirmation() {
  const { token } = useParams();
  const [data, setData] = useState<PublicConfirmation | null>(null);
  const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const [outcome, setOutcome] = useState(''); const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false); const [reason, setReason] = useState('');
  useEffect(() => {
    api<PublicConfirmation>(`/confirmations/${token}`).then(setData).catch(error => setError(messageOf(error))).finally(() => setLoading(false));
  }, [token]);
  async function respond(response: 'CONFIRMED' | 'REJECTED') {
    setBusy(true); setError('');
    try { const result = await api<{ message: string }>(`/confirmations/${token}`, { method: 'POST', public: true, body: json({ response, reason }) }); setOutcome(result.message); }
    catch (error) { setError(messageOf(error)); }
    finally { setBusy(false); }
  }
  return <div className="confirmation-layout"><div className="public-controls"><ThemeToggle /></div><div className="public-brand"><Brand /></div><section className="panel confirmation-card">
    {loading ? <Loading /> : outcome ? <div className="success-state"><span className="success-icon"><Icon name="check" size={32} /></span><h1>{rejecting ? 'OS reaberta' : 'Aceite confirmado'}</h1><p>{outcome}</p><small>Você pode fechar esta página.</small></div> : <>
      <span className="eyebrow">CONFIRMAÇÃO DE ATENDIMENTO</span><h1>O problema foi resolvido?</h1><Notice message={error} error />{data && <>
        <p>Olá, <strong>{data.requester}</strong>. Revise o serviço antes de registrar seu aceite.</p><div className="public-order"><span className="order-number">OS #{data.number}</span><h2>{data.title}</h2><p className="preserve">{data.description}</p><dl><div><dt>Técnico</dt><dd>{data.technician}</dd></div><div><dt>Concluído em</dt><dd>{date(data.resolvedAt)}</dd></div></dl><h3>Solução informada</h3><p className="preserve">{data.solution}</p></div>
        {rejecting ? <form onSubmit={event => { event.preventDefault(); void respond('REJECTED'); }}><Field label="O que ainda precisa ser resolvido?"><textarea required maxLength={5000} rows={4} value={reason} onChange={event => setReason(event.target.value)} /></Field><div className="button-row"><button className="button danger" disabled={busy || !reason.trim()}>{busy ? 'Registrando…' : 'Recusar e reabrir OS'}</button><button className="button secondary" type="button" disabled={busy} onClick={() => setRejecting(false)}>Voltar</button></div></form> : <div className="confirmation-actions"><button className="button" disabled={busy} onClick={() => respond('CONFIRMED')}><Icon name="check" />{busy ? 'Registrando…' : 'Confirmar atendimento'}</button><button className="button secondary" disabled={busy} onClick={() => setRejecting(true)}>O problema continua</button></div>}
        <small className="confirmation-disclaimer">Link válido até {date(data.expiresAt)}. Abrir esta página não registra o aceite.</small>
      </>}
    </>}
  </section></div>;
}
