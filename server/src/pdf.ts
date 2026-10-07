import PDFDocument from 'pdfkit';
import type { Orders } from './orders.js';

const formatDate = (value: Date | string | null) => value ? new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short',
}).format(new Date(value)) : '—';
const acceptances = { NOT_REQUESTED: 'Não solicitado', PENDING: 'Pendente', CONFIRMED: 'Confirmado', REJECTED: 'Recusado' };
export function statusLabel(order: { status: string; technician_name: string | null; resolved_by_name: string | null }) {
  if (order.status === 'ASSIGNED') return `Atribuído a ${order.technician_name}`;
  if (order.status === 'RESOLVED') return `Resolvido por ${order.resolved_by_name}`;
  return 'Aberto';
}
export async function orderPdf(order: Awaited<ReturnType<Orders['detail']>>) {
  const doc = new PDFDocument({ size: 'A4', margins: { top: 54, bottom: 60, left: 54, right: 54 }, bufferPages: true,
    info: { Title: `Ordem de serviço #${order.number}`, Author: 'Controle de OS' } });
  const chunks: Buffer[] = [];
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  const section = (title: string, content: string) => {
    if (doc.y > doc.page.height - 140) doc.addPage();
    doc.moveDown().font('Helvetica-Bold').fontSize(11).fillColor('#087c74').text(title);
    doc.moveDown(0.35).font('Helvetica').fontSize(10).fillColor('#23343c').text(content, { lineGap: 3 });
  };
  doc.font('Helvetica-Bold').fontSize(23).fillColor('#16333e').text(`Ordem de serviço #${order.number}`);
  doc.moveDown(0.4).font('Helvetica').fontSize(13).text(order.title);
  section('Identificação', `Solicitante: ${order.requester_name}\nEmail: ${order.requester_email}\nAbertura: ${formatDate(order.created_at)}\nAtualização: ${formatDate(order.updated_at)}\nStatus: ${statusLabel(order)}\nAceite: ${acceptances[order.acceptance]}`);
  section('Descrição do chamado', order.description);
  if (order.solution) section('Atendimento', `Técnico: ${order.resolved_by_name}\nConclusão: ${formatDate(order.resolved_at)}\nVersão do atendimento: ${order.resolution_version}\n\n${order.solution}`);
  section('Histórico', order.events.map(event => `${formatDate(event.created_at)} · ${event.actor_name}\n${event.message}`).join('\n\n'));
  if (order.confirmations.length) section('Registros de aceite', order.confirmations.map(confirmation =>
    `Atendimento ${confirmation.version} · ${confirmation.requester_name}\nEnvio: ${confirmation.email_status === 'SENT' ? 'Enviado' : confirmation.email_status === 'FAILED' ? 'Falhou' : 'Pendente'}\nResposta: ${confirmation.response === 'CONFIRMED' ? 'Confirmado' : confirmation.response === 'REJECTED' ? 'Recusado' : 'Pendente'}${confirmation.invalidated_at ? ' · Link invalidado' : ''}\n${confirmation.responded_at ? `Data do aceite/recusa: ${formatDate(confirmation.responded_at)}` : `Validade do link: ${formatDate(confirmation.expires_at)}`}${confirmation.reason ? `\nJustificativa: ${confirmation.reason}` : ''}`,
  ).join('\n\n'));
  const range = doc.bufferedPageRange();
  for (let page = range.start; page < range.start + range.count; page++) {
    doc.switchToPage(page);
    doc.font('Helvetica').fontSize(8).fillColor('#667880').text(`Controle de OS · Horário de Brasília · Página ${page + 1} de ${range.count}`, 54, doc.page.height - 38, { lineBreak: false });
  }
  doc.end();
  return finished;
}
