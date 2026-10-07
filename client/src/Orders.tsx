import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, json } from './api';
import { useAuth } from './App';
import { useLive } from './Live';
import type { Detail, List, Order, User } from './types';
import { acceptanceLabels, Badge, date, Field, Icon, Loading, Notice } from './ui';

const messageOf = (error: unknown) => error instanceof Error ? error.message : 'Falha inesperada.';
export function OrderList() {
  const { user } = useAuth(); const { revision } = useLive();
  const [data, setData] = useState<List | null>(null); const [error, setError] = useState('');
  const [query, setQuery] = useState(''); const [page, setPage] = useState(1); const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true; setLoading(true); setError('');
    api<List>(`/orders?${query}&page=${page}`).then(result => { if (active) setData(result); })
      .catch(error => { if (active) { setError(messageOf(error)); setData(null); } }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [query, page, revision]);
  function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const values = new FormData(event.currentTarget); const params = new URLSearchParams();
    for (const [key, value] of values) if (String(value).trim()) params.set(key, String(value).trim());
    setPage(1); setQuery(params.toString());
  }
  return <><div className="page-heading"><div><span className="eyebrow">ACOMPANHE CADA ETAPA</span><h1>Ordens de serviço<span className="heading-dot">.</span></h1><p>{user.role === 'TECHNICIAN' ? 'Seus atendimentos atribuídos, da execução ao aceite.' : user.role === 'REQUESTER' ? 'Abra um chamado e acompanhe seus atendimentos.' : 'Consulte os chamados e organize os atendimentos da equipe.'}</p></div>{user.role === 'REQUESTER' && <Link className="button" to="/ordens/nova"><Icon name="plus" />Nova ordem</Link>}</div>
    <section className="panel"><div className="panel-heading"><div><h2>Consulta de chamados</h2><p>Combine os filtros para encontrar uma ordem.</p></div><span className="subtle-tag">DATA DE ABERTURA</span></div><form className={`filters ${user.role === 'REQUESTER' ? 'filters-requester' : ''}`} onSubmit={filter}><Field label="Data inicial"><input type="date" name="from" /></Field><Field label="Data final"><input type="date" name="to" /></Field>{user.role !== 'REQUESTER' && <Field label="Solicitante"><input name="requester" placeholder="Nome do solicitante" maxLength={120} /></Field>}<Field label="Número da OS"><input name="number" type="number" min={1} max={2147483647} placeholder="Ex.: 12" /></Field><div className="filter-actions"><button className="button" disabled={loading}><Icon name="search" />Consultar</button><button type="reset" className="text-button" onClick={() => { setPage(1); setQuery(''); }}>Limpar</button></div></form></section>
    <Notice message={error} error /><section className="panel list-panel"><div className="panel-heading"><h2>Chamados <span className="count-pill">{data?.total ?? 0}</span></h2><span className="muted">Mais recentes primeiro</span></div>
      {loading && !data ? <Loading /> : !data?.items.length ? <div className="empty-state"><span className="empty-icon"><Icon name="file" size={30} /></span><h3>Nenhuma ordem encontrada</h3><p>{query ? 'Ajuste os filtros e consulte novamente.' : user.role === 'REQUESTER' ? 'Comece abrindo sua primeira ordem de serviço.' : 'Os chamados disponíveis aparecerão aqui.'}</p>{!query && user.role === 'REQUESTER' && <Link className="button secondary" to="/ordens/nova">Abrir uma ordem</Link>}</div> : <><div className="table-scroll"><table><thead><tr><th>OS / Chamado</th><th>Solicitante</th><th>Status</th><th>Aceite</th><th>Abertura</th><th><span className="sr-only">Ações</span></th></tr></thead><tbody>{data.items.map(order => <tr key={order.id}><td><Link className="order-link" to={`/ordens/${order.id}`}><span className="order-number">#{String(order.number).padStart(4, '0')}</span><strong>{order.title}</strong></Link></td><td>{order.requester_name}</td><td><Badge order={order} /></td><td>{order.acceptance === 'NOT_REQUESTED' ? <span className="muted">—</span> : <Badge order={order} acceptance />}</td><td className="nowrap">{date(order.created_at, false)}</td><td><Link className="table-action" to={`/ordens/${order.id}`} aria-label={`Abrir OS ${order.number}`}>Ver OS <span>↗</span></Link></td></tr>)}</tbody></table></div><div className="pagination"><span>{(page - 1) * 20 + 1}–{Math.min(page * 20, data.total)} de {data.total} ordens</span><div><button className="button small secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>Anterior</button><span>Página {page}</span><button className="button small secondary" disabled={page * 20 >= data.total} onClick={() => setPage(page + 1)}>Próxima</button></div></div></>}
    </section></>;
}
export function NewOrder() {
  const { user } = useAuth(); const navigate = useNavigate();
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState(''); const [description, setDescription] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setBusy(true); const values = new FormData(event.currentTarget);
    try { const order = await api<Order>('/orders', { method: 'POST', body: json({ title: values.get('title'), description: values.get('description') }) }); navigate(`/ordens/${order.id}`); }
    catch (error) { setError(messageOf(error)); } finally { setBusy(false); }
  }
  return <><Link to="/ordens" className="back-link"><Icon name="arrow" size={17} />Ordens de serviço</Link><div className="page-heading"><div><span className="eyebrow">NOVO CHAMADO</span><h1>Como podemos ajudar?</h1><p>Descreva o problema para que a equipe possa iniciar o atendimento.</p></div></div><div className="detail-grid"><section className="panel"><div className="panel-heading"><h2>Dados da ordem</h2></div><form className="panel-body" onSubmit={submit}><Notice message={error} error /><Field label="Título do chamado" hint={`${title.length}/50 caracteres`}><input name="title" value={title} onChange={event => setTitle(event.target.value)} required minLength={3} maxLength={50} placeholder="Resuma o problema em uma frase" /></Field><Field label="Descrição" hint={`${description.length}/255 caracteres. Informe o problema de forma objetiva.`}><textarea name="description" value={description} onChange={event => setDescription(event.target.value)} rows={5} required minLength={5} maxLength={255} placeholder="Descreva o problema…" /></Field><div className="button-row"><button className="button" disabled={busy}><Icon name="plus" />{busy ? 'Abrindo…' : 'Abrir ordem de serviço'}</button><Link className="button secondary" to="/ordens">Cancelar</Link></div></form></section><aside className="panel info-panel"><span className="eyebrow">IDENTIFICAÇÃO AUTOMÁTICA</span><h3>{user.name}</h3><p>{user.email}</p><hr /><p>O número e a data da OS são gerados na abertura.</p><p>Limite de 10 novos chamados em 60 minutos.</p><p>Após a solução, você receberá um email para confirmar o atendimento.</p></aside></div></>;
}
export function OrderDetail() {
  const { id } = useParams(); const { user } = useAuth(); const { revision } = useLive();
  const [order, setOrder] = useState<Detail | null>(null); const [technicians, setTechnicians] = useState<User[]>([]);
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [warning, setWarning] = useState(false);
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false);
  const [selectedTechnician, setSelectedTechnician] = useState('');
  const [assignmentDirty, setAssignmentDirty] = useState(false);
  useEffect(() => { setAssignmentDirty(false); }, [id]);
  useEffect(() => {
    if (!assignmentDirty) setSelectedTechnician(order?.technician_id || '');
  }, [order?.id, order?.technician_id, assignmentDirty]);
  const load = useCallback(async () => { const data = await api<Detail>(`/orders/${id}`); setOrder(data); }, [id]);
  useEffect(() => {
    setLoading(true); setError('');
    const work: Promise<unknown>[] = [load()];
    if (user.role === 'ADMIN') work.push(api<User[]>('/technicians').then(setTechnicians));
    Promise.all(work).catch(error => setError(messageOf(error))).finally(() => setLoading(false));
  }, [load, user.role]);
  useEffect(() => {
    if (!revision || busy) return;
    let active = true;
    api<Detail>(`/orders/${id}`).then(data => { if (active) setOrder(data); }).catch(error => {
      if (!active) return; setError(messageOf(error));
      if (error instanceof ApiError && error.status === 404) setOrder(null);
    });
    return () => { active = false; };
  }, [id, revision]);
  async function action(endpoint: string, body?: unknown) {
    setError(''); setNotice(''); setBusy(true);
    try { const result = await api<{ message?: string; emailStatus?: string }>(`/orders/${id}/${endpoint}`, { method: 'POST', body: body ? json(body) : undefined }); setNotice(result.message || 'Atribuição atualizada.'); setWarning(result.emailStatus === 'FAILED'); await load(); if (endpoint === 'assign') setAssignmentDirty(false); }
    catch (error) { setError(messageOf(error)); } finally { setBusy(false); }
  }
  if (loading) return <Loading />;
  if (!order) return <><Notice message={error} error /><Link to="/ordens">Voltar para a consulta</Link></>;
  const latest = order.confirmations[0];
  return <><Link to="/ordens" className="back-link"><Icon name="arrow" size={17} />Ordens de serviço</Link><div className="page-heading"><div><span className="eyebrow">ORDEM #{String(order.number).padStart(4, '0')}</span><h1>{order.title}</h1><p>Aberta em {date(order.created_at)} por {order.requester_name}</p></div><a className="button secondary" href={`/api/orders/${order.id}/pdf`}><Icon name="download" />Baixar PDF</a></div><Notice message={error} error /><Notice message={notice} error={warning} />
    <div className="detail-grid"><div className="detail-main"><section className="panel"><div className="panel-heading"><h2>Detalhes do chamado</h2><Badge order={order} /></div><div className="panel-body"><dl className="metadata"><div><dt>Solicitante</dt><dd>{order.requester_name}</dd></div><div><dt>Email</dt><dd>{order.requester_email}</dd></div><div><dt>Técnico atribuído</dt><dd>{order.technician_name || 'Aguardando atribuição'}</dd></div><div><dt>Última atualização</dt><dd>{date(order.updated_at)}</dd></div></dl><h3>Descrição</h3><p className="preserve">{order.description}</p>{order.solution && <div className="solution-box"><h3>Solução informada</h3><p className="preserve">{order.solution}</p><small>{order.resolved_by_name} · {date(order.resolved_at)}</small></div>}</div></section>
      <section className="panel"><div className="panel-heading"><h2>Histórico do atendimento</h2><span className="subtle-tag">{order.events.length} REGISTROS</span></div><ol className="timeline">{order.events.map(event => <li key={event.id}><span className={`timeline-dot ${event.kind === 'CONFIRMED' ? 'complete' : ''}`} /><div className="event-header"><strong>{event.actor_name}</strong><time>{date(event.created_at)}</time></div><p className="preserve">{event.message}</p></li>)}</ol></section></div>
      <aside className="detail-aside"><section className="panel info-panel"><span className="eyebrow">CONFIRMAÇÃO DO SOLICITANTE</span><h2>Aceite do atendimento</h2><Badge order={order} acceptance /><p>{order.acceptance === 'CONFIRMED' ? 'O solicitante confirmou o atendimento pelo link recebido por email.' : order.acceptance === 'REJECTED' ? 'O solicitante recusou o atendimento. A OS foi reaberta para uma nova solução.' : order.acceptance === 'PENDING' ? 'Atendimento resolvido. Aguardando confirmação pelo link enviado ao solicitante.' : 'O email de confirmação será enviado quando o técnico registrar a solução.'}</p>
        {latest && <div className="acceptance-details"><div><span>Último email</span><strong>{latest.email_status === 'SENT' ? 'Enviado' : latest.email_status === 'FAILED' ? 'Falha no envio' : 'Envio pendente'}</strong></div>{latest.responded_at ? <div><span>Resposta registrada</span><strong>{date(latest.responded_at)}</strong></div> : !latest.invalidated_at && <div><span>Validade do link</span><strong>{date(latest.expires_at)}</strong></div>}{latest.reason && <p className="preserve">Motivo: {latest.reason}</p>}</div>}
        {order.status === 'RESOLVED' && order.acceptance === 'PENDING' && user.role !== 'REQUESTER' && <button className="button secondary full" disabled={busy} onClick={() => action('resend')}>{busy ? 'Aguarde…' : 'Reenviar email'}</button>}
      </section>
      {user.role === 'ADMIN' && order.status !== 'RESOLVED' && <section className="panel info-panel"><h2>Atribuir atendimento</h2><p>Selecione o técnico responsável pela solução.</p><form onSubmit={event => { event.preventDefault(); const values = new FormData(event.currentTarget); void action('assign', { technicianId: values.get('technicianId') }); }}><Field label="Técnico"><select name="technicianId" required value={selectedTechnician} onChange={event => { setSelectedTechnician(event.target.value); setAssignmentDirty(true); }}><option value="">Selecione um técnico</option>{technicians.map(technician => <option value={technician.id} key={technician.id}>{technician.name}</option>)}</select></Field><button className="button full" disabled={busy || !technicians.length}>{busy ? 'Atribuindo…' : order.status === 'ASSIGNED' ? 'Reatribuir OS' : 'Atribuir OS'}</button>{!technicians.length && <p className="muted">Cadastre um técnico ativo na área de usuários.</p>}</form></section>}
      {user.role === 'TECHNICIAN' && order.status === 'ASSIGNED' && <section className="panel info-panel"><h2>Registrar solução</h2><p>A resolução envia o pedido de aceite ao solicitante.</p><form onSubmit={event => { event.preventDefault(); const values = new FormData(event.currentTarget); void action('resolve', { solution: values.get('solution') }); }}><Field label="Solução realizada"><textarea name="solution" required minLength={5} maxLength={20000} rows={5} placeholder="Descreva o serviço realizado" /></Field><button className="button full" disabled={busy}>{busy ? 'Registrando…' : 'Resolver e solicitar aceite'}</button></form></section>}
    </aside></div></>;
}
