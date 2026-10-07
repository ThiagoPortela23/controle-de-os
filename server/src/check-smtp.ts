import { readConfig } from './config.js';
import { createSmtpTransport, smtpErrorMessage } from './email.js';

async function main() {
  let config;
  try { config = readConfig(); }
  catch (error) { console.error(error instanceof Error ? error.message : 'Configuração SMTP inválida.'); process.exitCode = 1; return; }
  const transport = createSmtpTransport(config);
  try { await transport.verify(); console.log('SMTP conectado e autenticação validada. Nenhum email foi enviado.'); }
  catch (error) { console.error(smtpErrorMessage(error)); process.exitCode = 1; }
  finally { transport.close(); }
}
void main();
