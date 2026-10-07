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
  SMTP_HOST: z.string().default('localhost'), SMTP_PORT: z.coerce.number().default(1025),
  SMTP_SECURE: boolean.default(false), SMTP_USER: z.string().default(''), SMTP_PASS: z.string().default(''),
  SMTP_FROM: z.string().default('Ordens de Serviço <os@example.com>'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});
export type Config = z.infer<typeof schema>;
export function readConfig(): Config {
  const result = schema.safeParse(process.env);
  if (!result.success) throw new Error(`Configuração inválida: ${result.error.issues.map(i => i.path.join('.')).join(', ')}`);
  const config = result.data;
  if (config.NODE_ENV === 'production' && !config.APP_PUBLIC_URL.startsWith('https://')) {
    throw new Error('APP_PUBLIC_URL precisa usar HTTPS em produção.');
  }
  return config;
}
