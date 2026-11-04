import { BOOTSTRAP_ADMIN } from '../src/auth.js';
import type { createApp } from '../src/app.js';

type App = ReturnType<typeof createApp>;

/** A test client that sends the session cookie of a signed-in user with every request. */
export interface Client {
  request(path: string, init?: RequestInit): Promise<Response>;
  cookie: string;
}

export async function signIn(
  app: App,
  username: string = BOOTSTRAP_ADMIN.username,
  password: string = BOOTSTRAP_ADMIN.password,
): Promise<Client> {
  const res = await app.request('/api/auth/login', json('POST', { username, password }));
  if (res.status !== 200) throw new Error(`sign-in as ${username} failed with ${res.status}`);
  const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0];
  return {
    cookie,
    request: async (path, init = {}) => {
      const headers = new Headers(init.headers);
      headers.set('cookie', cookie);
      return app.request(path, { ...init, headers });
    },
  };
}

export const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});
