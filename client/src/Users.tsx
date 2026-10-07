import { useEffect, useState, type FormEvent } from 'react';
import { api, json } from './api';
import { useAuth } from './App';
import type { User } from './types';
import { Field, Icon, Loading, Notice, PasswordInput, roles } from './ui';

export function Users() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<User[]>([]); const [error, setError] = useState('');
  const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(true);
  const [resetUser, setResetUser] = useState<User | null>(null);
  async function load() { setUsers(await api<User[]>('/users')); }
  useEffect(() => { load().catch(error => setError(error.message)).finally(() => setLoading(false)); }, []);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const fields = new FormData(form); setBusy(true); setError(''); setNotice('');
    try { await api('/users', { method: 'POST', body: json(Object.fromEntries(fields)) }); await load(); form.reset(); setNotice('Conta criada. Entregue a senha temporária ao usuário por um canal apropriado.'); }
    catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  }
  async function change(user: User, changes: { active?: boolean; temporaryPassword?: string }) {
    setBusy(true); setError(''); setNotice('');
    try { await api(`/users/${user.id}`, { method: 'PATCH', body: json(changes) }); await load(); setResetUser(null); setNotice(changes.temporaryPassword ? 'Senha temporária redefinida. O usuário deverá trocá-la no próximo acesso.' : 'Acesso atualizado. OS existentes permanecem no histórico; reatribua atendimentos de técnicos desativados.'); }
    catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  }
  return <><div className="page-heading"><div><span className="eyebrow">ADMINISTRAÇÃO</span><h1>Pessoas e acessos<span className="heading-dot">.</span></h1><p>Defina quem solicita, quem atende e quem organiza a central.</p></div></div><Notice message={error} error /><Notice message={notice} />
    <section className="panel"><div className="panel-heading"><h2>Criar usuário</h2><span className="subtle-tag">ACESSO POR PERFIL</span></div><form className="user-form panel-body" onSubmit={create}><Field label="Nome"><input name="name" required minLength={2} maxLength={120} placeholder="Nome completo" /></Field><Field label="Email"><input name="email" type="email" required placeholder="usuario@empresa.com" /></Field><Field label="Perfil"><select name="role" defaultValue="REQUESTER"><option value="REQUESTER">Solicitante</option><option value="TECHNICIAN">Técnico</option><option value="ADMIN">Administrador</option></select></Field><Field label="Senha temporária" hint="Pelo menos 10 caracteres; troca obrigatória no primeiro acesso."><PasswordInput name="temporaryPassword" autoComplete="new-password" required minLength={10} maxLength={128}  visibilityLabel="senha temporária" /></Field><div><button className="button" disabled={busy}><Icon name="plus" />{busy ? 'Aguarde…' : 'Criar conta'}</button></div></form></section>
    <section className="panel list-panel"><div className="panel-heading"><h2>Usuários cadastrados <span className="count-pill">{users.length}</span></h2></div>{loading ? <Loading /> : <div className="table-scroll"><table><thead><tr><th>Usuário</th><th>Perfil</th><th>Acesso</th><th>Ações</th></tr></thead><tbody>{users.map(user => <tr key={user.id}><td><strong>{user.name}</strong><small className="block muted">{user.email}</small></td><td>{roles[user.role]}</td><td><span className={`badge ${user.active ? 'badge-confirmed' : 'badge-rejected'}`}><i />{user.active ? 'Ativo' : 'Desativado'}</span>{user.must_change_password && <small className="block muted">Troca de senha pendente</small>}</td><td>{user.id === currentUser.id ? <span className="muted">Sua conta</span> : <div className="button-row"><button className="button small secondary" disabled={busy} onClick={() => change(user, { active: !user.active })}>{user.active ? 'Desativar' : 'Ativar'}</button><button className="text-button" disabled={busy} onClick={() => setResetUser(user)}>Redefinir senha</button></div>}</td></tr>)}</tbody></table></div>}</section>
    {resetUser && <div className="modal-backdrop"><section className="panel modal" role="dialog" aria-modal="true" aria-labelledby="reset-title"><h2 id="reset-title">Redefinir senha</h2><p>Nova senha temporária para {resetUser.name}.</p><form onSubmit={event => { event.preventDefault(); void change(resetUser, { temporaryPassword: String(new FormData(event.currentTarget).get('temporaryPassword')) }); }}><Field label="Nova senha temporária"><PasswordInput autoFocus name="temporaryPassword" autoComplete="new-password" required minLength={10} maxLength={128}  visibilityLabel="nova senha temporária" /></Field><div className="button-row"><button className="button" disabled={busy}>Redefinir</button><button type="button" className="button secondary" disabled={busy} onClick={() => setResetUser(null)}>Cancelar</button></div></form></section></div>}
  </>;
}
