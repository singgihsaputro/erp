import type { Context } from 'hono';
import type { ZodTypeAny, z } from 'zod';
import type { SessionUser } from '@erp/shared';

/** Hono environment for every route behind sign-in: `c.get('user')` is the signed-in user. */
export type AppEnv = { Variables: { user: SessionUser } };

export type HttpStatus = 400 | 401 | 403 | 404 | 409 | 413 | 415 | 422 | 429;

export class HttpError extends Error {
  constructor(public status: HttpStatus, message: string, public details?: unknown) {
    super(message);
  }
}

export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (!r.success) throw new HttpError(400, 'Validation failed', r.error.flatten());
  return r.data;
}

export async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON');
  }
}

export function parseId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Invalid id');
  return id;
}
