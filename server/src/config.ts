import 'dotenv/config';
import { z } from 'zod';

const boolean = z.enum(['true', 'false']).transform(value => value === 'true');
const schema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_PUBLIC_URL: z.url().default('http://localhost:3000'),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
  ADMIN_NAME: z.string().min(1).default('Administrador'),
  ADMIN_EMAIL: z.email(), ADMIN_PASSWORD: z.string().min(10).max(128),
  SMTP_HOST: z.string().trim().min(1).default('smtp.gmail.com'), SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(465),
  SMTP_SECURE: boolean.default(true), SMTP_USER: z.string().trim().default(''), SMTP_PASS: z.string().default(''),
  SMTP_FROM: z.string().trim().default(''),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
}).superRefine((config, context) => {
  const issue = (path: string, message: string) => context.addIssue({ code: 'custom', path: [path], message });
  if (config.SMTP_HOST.toLowerCase() === 'smtp.gmail.com') {
    if (!z.email().safeParse(config.SMTP_USER).success) issue('SMTP_USER', 'Informe a conta Gmail remetente.');
    if (config.SMTP_PASS.replace(/\s/g, '').length !== 16) issue('SMTP_PASS', 'Informe a senha de aplicativo do Gmail com 16 caracteres.');
    if (![465, 587].includes(config.SMTP_PORT)) issue('SMTP_PORT', 'Use 465 (TLS) ou 587 (STARTTLS) para Gmail.');
    if (config.SMTP_SECURE !== (config.SMTP_PORT === 465)) issue('SMTP_SECURE', 'Use true na porta 465 ou false na porta 587.');
  } else if (Boolean(config.SMTP_USER) !== Boolean(config.SMTP_PASS)) {
    issue(config.SMTP_USER ? 'SMTP_PASS' : 'SMTP_USER', 'Configure usuário e senha SMTP em conjunto.');
  }
  if (!config.SMTP_FROM && config.SMTP_HOST.toLowerCase() !== 'smtp.gmail.com' && !z.email().safeParse(config.SMTP_USER).success) issue('SMTP_FROM', 'Informe o remetente SMTP.');
});
export type Config = z.infer<typeof schema>;
export function parseConfig(environment: Record<string, string | undefined>): Config {
  const result = schema.safeParse(environment);
  if (!result.success) throw new Error(`Configuração inválida: ${result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(' ')}`);
  const config = result.data;
  if (!config.SMTP_FROM) config.SMTP_FROM = `Central de Serviços <${config.SMTP_USER}>`;
  if (config.SMTP_HOST.toLowerCase() === 'smtp.gmail.com') config.SMTP_PASS = config.SMTP_PASS.replace(/\s/g, '');
  if (config.NODE_ENV === 'production' && !config.APP_PUBLIC_URL.startsWith('https://')) {
    throw new Error('APP_PUBLIC_URL precisa usar HTTPS em produção.');
  }
  return config;
}
export function readConfig(): Config { return parseConfig(process.env); }
