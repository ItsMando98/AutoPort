import { timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';

interface ApiSecurityEnvironment {
  API_HOST?: string;
}

export function resolveApiHost(env: ApiSecurityEnvironment = process.env): string {
  return env.API_HOST?.trim() || '127.0.0.1';
}

export function assertSafeApiExposure(host: string, token: string | undefined): void {
  const normalized = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
  const loopback = normalized === '127.0.0.1' || normalized === 'localhost' || normalized === '::1';
  if (!loopback && !token?.trim()) {
    throw new Error(`Refusing to expose the API on ${host} without API_AUTH_TOKEN`);
  }
}

export function requireMutationAuth(options: { token?: string } = {}): RequestHandler {
  const expectedToken = options.token ?? process.env.API_AUTH_TOKEN;
  return (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS' || !expectedToken) {
      next();
      return;
    }

    const authorization = req.headers.authorization ?? '';
    const suppliedToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    const expected = Buffer.from(expectedToken);
    const supplied = Buffer.from(suppliedToken);
    const matches = expected.length === supplied.length && timingSafeEqual(expected, supplied);
    if (!matches) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    next();
  };
}
