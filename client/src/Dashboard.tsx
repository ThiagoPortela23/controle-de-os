import { useEffect, useState } from 'react';
import { api } from './api';
import { useLive } from './Live';
import { Field, Loading, Notice } from './ui';
import type { DashboardData, Ranking } from './types';

const zone = 'America/Sao_Paulo';
const months = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
function period(now: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit' }).formatToParts(now);
  return { year: Number(parts.find(part => part.type === 'year')!.value), month: Number(parts.find(part => part.type === 'month')!.value) };
}
function RankingPanel({ title, description, items }: { title: string; description: string; items: Ranking[] }) {
  return <section className="panel ranking-panel"><div className="panel-heading"><div><h2>{title}</h2><p>{description}</p></div></div>
    {items.length ? <ol className="ranking-list">{items.map((item, index) => <li key={item.id}>
      <span className="ranking-position">{index + 1}</span><div><strong>{item.name}</strong><progress aria-label={`${item.name}: ${item.total} chamados`} value={item.total} max={items[0].total} /></div>
      <span className="ranking-total">{item.total}<small>chamados</small></span>
    </li>)}</ol> : <div className="empty-state">Nenhum atendimento neste ranking.</div>}
  </section>;
}
function MonthlyChart({ series, year }: { series: DashboardData['monthlySeries']; year: number }) {
  const max = Math.ceil(Math.max(1, ...series.flatMap(item => [item.opened, item.resolved])) / 3) * 3;
  return <section className="panel"><div className="panel-heading"><div><h2>Chamados por mês · {year}</h2><p>Resoluções consideram a situação atual das OS.</p></div>
    <div className="chart-legend"><span className="legend-opened">Aberturas</span><span className="legend-resolved">Resoluções</span></div></div>
    <div className="chart-body"><svg className="monthly-chart" viewBox="0 0 800 235" role="img" aria-label={`Aberturas e resoluções por mês em ${year}`}>
      <title>Aberturas e resoluções por mês em {year}; os valores também estão na tabela abaixo.</title>
      {[0, 1, 2, 3].map(tick => <g key={tick}><line x1="45" x2="790" y1={190 - tick * 50} y2={190 - tick * 50} className="chart-grid" />
        <text x="35" y={194 - tick * 50} textAnchor="end" className="chart-label">{max * tick / 3}</text></g>)}
      {series.map(item => { const x = 55 + (item.month - 1) * 61; return <g key={item.month}>
        <rect x={x} y={190 - item.opened / max * 150} width="20" height={item.opened / max * 150} rx="3" className="chart-opened"><title>{months[item.month - 1]}: {item.opened} aberturas</title></rect>
        <rect x={x + 23} y={190 - item.resolved / max * 150} width="20" height={item.resolved / max * 150} rx="3" className="chart-resolved"><title>{months[item.month - 1]}: {item.resolved} resoluções</title></rect>
        <text x={x + 21} y="215" textAnchor="middle" className="chart-label">{months[item.month - 1].slice(0, 3)}</text>
      </g>; })}
    </svg></div><p className="chart-scroll-hint">Deslize o gráfico para ver todos os meses.</p><div className="chart-body chart-table"><details className="chart-data"><summary>Ver dados do gráfico</summary><div className="table-scroll"><table><thead><tr><th>Mês</th><th>Aberturas</th><th>Resoluções</th></tr></thead><tbody>
      {series.map(item => <tr key={item.month}><td>{months[item.month - 1]}</td><td>{item.opened}</td><td>{item.resolved}</td></tr>)}
    </tbody></table></div></details></div>
  </section>;
}
export function Dashboard() {
  const { revision } = useLive(); const initial = period(new Date());
  const [year, setYear] = useState(initial.year); const [month, setMonth] = useState(initial.month);
  const [now, setNow] = useState(new Date()); const [data, setData] = useState<DashboardData | null>(null); const [error, setError] = useState('');
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(now);
  useEffect(() => { const timer = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    const controller = new AbortController();
    api<DashboardData>(`/dashboard?year=${year}&month=${month}`, { signal: controller.signal }).then(result => { setData(result); setError(''); })
      .catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [year, month, revision, day]);
  return <><div className="page-heading"><div><span className="eyebrow">VISÃO DA OPERAÇÃO</span><h1>Dashboard</h1><p>Fila de atendimento, volume de chamados e resultados da equipe.</p></div>
    <div className="dashboard-clock"><strong aria-label="Hora de Brasília">{new Intl.DateTimeFormat('pt-BR', { timeZone: zone, timeStyle: 'medium' }).format(now)}</strong>
      <span>{new Intl.DateTimeFormat('pt-BR', { timeZone: zone, dateStyle: 'long' }).format(now)}</span><small>Horário de Brasília</small></div></div>
    <section className="panel"><form className="dashboard-filters" onSubmit={event => {
      event.preventDefault(); const values = new FormData(event.currentTarget); setYear(Number(values.get('year'))); setMonth(Number(values.get('month')));
    }}><Field label="Ano"><input type="number" name="year" min={2000} max={9999} defaultValue={year} required /></Field>
      <Field label="Mês"><select name="month" defaultValue={month}>{months.map((name, index) => <option value={index + 1} key={name}>{name}</option>)}</select></Field>
      <button className="button">Aplicar período</button><p>Período: {months[month - 1]} de {year}. A fila atual e o total de hoje não dependem deste filtro.</p>
    </form></section><Notice message={error} error />
    {!data ? !error && <Loading /> : <>
      <div className="stats-grid dashboard-stats">{([
        ['Chamados hoje', data.dailyTotal, `abertos hoje - ${new Intl.DateTimeFormat('pt-BR', { timeZone: zone, day: '2-digit', month: '2-digit' }).format(now)}`, 'dailyTotal'],
        ['Chamados no mês', data.monthlyTotal, `${months[month - 1]} de ${year}`, 'monthlyTotal'],
        ['Abertos', data.open, 'Aguardando atribuição', 'open'],
        ['Atribuídos', data.assigned, 'Aguardando resolução', 'assigned'],
        ['Aceites pendentes', data.pendingAcceptance, 'Aguardando solicitante', 'pendingAcceptance'],
      ] as const).map(([label, value, hint, id]) => <div className="stat-card" key={id}><span className="stat-label">{label}</span><strong data-testid={`metric-${id}`}>{value}</strong><small>{hint}</small></div>)}</div>
      <MonthlyChart series={data.monthlySeries} year={year} /><div className="rankings-grid">
        <RankingPanel title="Top 5 · chamados atribuídos" description="Carga pendente atual, em todos os meses." items={data.assignedRanking} />
        <RankingPanel title="Top 5 · chamados resolvidos" description={`OS atualmente resolvidas em ${months[month - 1]} de ${year}.`} items={data.resolvedRanking} />
      </div>
    </>}
  </>;
}
