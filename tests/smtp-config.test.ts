import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConfig } from '../server/src/config.js';
import { smtpErrorMessage } from '../server/src/email.js';

const base = { DATABASE_URL: 'postgresql://fixture:fixture@localhost:5433/fixture',
  SESSION_SECRET: 'fixture-secret-with-more-than-thirty-two-characters', ADMIN_EMAIL: 'admin@example.com',
  ADMIN_PASSWORD: 'FixtureAdmin123!', NODE_ENV: 'test' };
const gmail = { ...base, SMTP_USER: 'sender@gmail.com', SMTP_PASS: 'abcd efgh ijkl mnop' };

test('Gmail usa TLS, exige senha de aplicativo e deriva remetente da conta autenticada', () => {
  const config = parseConfig(gmail);
  assert.equal(config.SMTP_HOST, 'smtp.gmail.com'); assert.equal(config.SMTP_PORT, 465); assert.equal(config.SMTP_SECURE, true);
  assert.equal(config.SMTP_PASS, 'abcdefghijklmnop'); assert.equal(config.SMTP_FROM, 'Central de Serviços <sender@gmail.com>');
  assert.throws(() => parseConfig(base), /SMTP_USER/);
  assert.throws(() => parseConfig({ ...gmail, SMTP_PASS: '' }), /SMTP_PASS/);
  assert.throws(() => parseConfig({ ...gmail, SMTP_PASS: 'not_an_app_password' }), /SMTP_PASS/);
  assert.throws(() => parseConfig({ ...gmail, SMTP_PORT: '465', SMTP_SECURE: 'false' }), /SMTP_SECURE/);
  assert.throws(() => parseConfig({ ...gmail, SMTP_PORT: '587', SMTP_SECURE: 'true' }), /SMTP_SECURE/);
  assert.throws(() => parseConfig({ ...gmail, SMTP_PORT: '1025' }), /SMTP_PORT/);
  const starttls = parseConfig({ ...gmail, SMTP_PORT: '587', SMTP_SECURE: 'false' });
  assert.equal(starttls.SMTP_PORT, 587); assert.equal(starttls.SMTP_SECURE, false);
});
test('SMTP de testes é explícito e não exige usuário/senha; configuração inválida não expõe segredos', () => {
  const local = parseConfig({ ...base, SMTP_HOST: '127.0.0.1', SMTP_PORT: '11025', SMTP_SECURE: 'false', SMTP_FROM: 'test@example.com' });
  assert.equal(local.SMTP_HOST, '127.0.0.1'); assert.equal(local.SMTP_USER, '');
  const secret = 'private-password-value-not-for-output';
  assert.throws(() => parseConfig({ ...gmail, SMTP_PASS: secret }), error => {
    assert.ok(error instanceof Error); assert.ok(!error.message.includes(secret)); return true;
  });
  assert.throws(() => parseConfig({ ...base, SMTP_HOST: 'smtp.company.example', SMTP_USER: 'account', SMTP_FROM: 'sender@example.com' }), /SMTP_PASS/);
});
test('falhas SMTP apresentam orientação sem conteúdo de respostas ou credenciais', () => {
  const secret = 'private-password';
  assert.match(smtpErrorMessage({ code: 'EAUTH', message: secret, response: secret }), /autenticação/);
  assert.match(smtpErrorMessage({ code: 'ETIMEDOUT', message: secret }), /conectar/);
  assert.match(smtpErrorMessage({ code: 'EENVELOPE', response: secret }), /destinatário/);
  for (const code of ['EAUTH', 'ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS', 'EENVELOPE', 'UNKNOWN']) {
    assert.ok(!smtpErrorMessage({ code, message: secret, response: secret }).includes(secret));
  }
});
