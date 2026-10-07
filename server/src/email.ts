import nodemailer from 'nodemailer';
import QRCode from 'qrcode';
import type { Config } from './config.js';
import type { Delivery } from './types.js';
import type { Pool } from 'pg';

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));
export type Mailer = (delivery: Delivery) => Promise<void>;
export function createSmtpTransport(config: Config) {
  return nodemailer.createTransport({
    host: config.SMTP_HOST, port: config.SMTP_PORT, secure: config.SMTP_SECURE,
    auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined,
    requireTLS: !config.SMTP_SECURE && config.SMTP_HOST.toLowerCase() === 'smtp.gmail.com',
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000,
  });
}
export function createMailer(config: Config): Mailer {
  const transport = createSmtpTransport(config);
  return async ({ order, confirmation, token }) => {
    const link = `${config.APP_PUBLIC_URL.replace(/\/$/, '')}/confirmacao/${token}`;
    const qr = await QRCode.toBuffer(link, { width: 280, margin: 2 });
    const subject = `Confirme o atendimento da OS #${order.number}`;
    const text = `Olá, ${confirmation.requester_name}.\n\nOS #${order.number}: ${order.title}\nTécnico: ${order.resolved_by_name}\nSolução: ${order.solution}\n\nConfirme ou recuse o atendimento: ${link}\nO link vale por 72 horas. Abrir o link não confirma o aceite.`;
    const result = await transport.sendMail({
      from: config.SMTP_FROM, to: confirmation.requester_email, subject, text,
      html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#16333e"><h1>Seu atendimento foi concluído</h1><p>Olá, ${escapeHtml(confirmation.requester_name)}.</p><p><strong>OS #${order.number}</strong> · ${escapeHtml(order.title)}</p><p>Técnico: ${escapeHtml(order.resolved_by_name || '')}</p><p style="white-space:pre-wrap">${escapeHtml(order.solution || '')}</p><p>Confira a solução e confirme ou recuse o atendimento.</p><p><a href="${escapeHtml(link)}" style="display:inline-block;background:#087c74;color:white;padding:14px 22px;border-radius:8px">Revisar atendimento</a></p><p>Ou escaneie o QR code:</p><img src="cid:acceptance-qr" width="280" height="280" alt="QR code para revisar o atendimento"/><p>Link válido por 72 horas. O aceite exige uma ação na página.</p></div>`,
      attachments: [{ filename: 'aceite.png', content: qr, cid: 'acceptance-qr', contentType: 'image/png' }],
    });
    const recipient = confirmation.requester_email.toLowerCase();
    if (!result.accepted.some(address => address.toLowerCase() === recipient)) {
      throw Object.assign(new Error('Destinatário não aceito pelo SMTP.'), { code: 'EENVELOPE' });
    }
  };
}
export function smtpErrorMessage(error: unknown) {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  if (code === 'EAUTH') return 'O SMTP recusou a autenticação. Confira a conta remetente e a senha de aplicativo.';
  if (code === 'ETIMEDOUT' || code === 'ECONNECTION' || code === 'ESOCKET' || code === 'EDNS') return 'Não foi possível conectar ao SMTP. Confira host, porta, TLS e conexão de rede.';
  if (code === 'EENVELOPE') return 'O SMTP recusou o remetente ou destinatário. Confira os endereços de email.';
  return 'O servidor SMTP não concluiu o envio.';
}
export async function deliver(pool: Pool, mailer: Mailer, delivery: Delivery) {
  let status: 'SENT' | 'FAILED' = 'SENT';
  let failure = '';
  try { await mailer(delivery); }
  catch (error) { status = 'FAILED'; failure = smtpErrorMessage(error); }
  await pool.query('UPDATE confirmations SET email_status=$2 WHERE id=$1', [delivery.confirmation.id, status]);
  return { emailStatus: status, message: status === 'SENT' ? 'Email de aceite enviado.' : `OS registrada, mas o email falhou. ${failure} Use “Reenviar email”.` };
}
