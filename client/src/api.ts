let csrfToken = '';
export function setCsrf(token: string) { csrfToken = token; }
export async function api<T>(path: string, options: RequestInit & { public?: boolean } = {}): Promise<T> {
  const { public: isPublic, ...init } = options;
  const headers = new Headers(init.headers);
  if (init.body) headers.set('Content-Type', 'application/json');
  if (init.method && !['GET', 'HEAD'].includes(init.method) && !isPublic) {
    if (!csrfToken) {
      const response = await fetch('/api/auth/csrf', { credentials: 'same-origin' });
      if (!response.ok) throw new Error('Não foi possível iniciar a sessão.');
      csrfToken = (await response.json()).csrfToken;
    }
    headers.set('X-CSRF-Token', csrfToken);
  }
  const response = await fetch(`/api${path}`, { ...init, headers, credentials: 'same-origin' });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Não foi possível completar a operação.');
  return data as T;
}
export const json = (value: unknown) => JSON.stringify(value);
