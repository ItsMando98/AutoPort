import test from 'node:test';
import assert from 'node:assert/strict';
import type { NextFunction, Request, Response } from 'express';
import { assertSafeApiExposure, requireMutationAuth, resolveApiHost } from '../server/apiSecurity.js';

test('API host defaults to loopback', () => {
  assert.equal(resolveApiHost({}), '127.0.0.1');
});

test('non-loopback exposure requires an authentication token', () => {
  assert.throws(() => assertSafeApiExposure('0.0.0.0', undefined), /API_AUTH_TOKEN/);
  assert.doesNotThrow(() => assertSafeApiExposure('0.0.0.0', 'strong-token'));
});

function invoke(token: string | undefined, authorization: string | undefined, method = 'POST') {
  let statusCode = 200;
  let body: unknown;
  let nextCalled = false;
  const req = { method, headers: { authorization } } as unknown as Request;
  const res = {
    status(code: number) { statusCode = code; return this; },
    json(value: unknown) { body = value; return this; },
  } as unknown as Response;
  const next = (() => { nextCalled = true; }) as NextFunction;
  requireMutationAuth({ token })(req, res, next);
  return { statusCode, body, nextCalled };
}

test('configured bearer authentication rejects missing and wrong credentials', () => {
  assert.deepEqual(invoke('secret', undefined), {
    statusCode: 401,
    body: { error: 'Unauthorized' },
    nextCalled: false,
  });
  assert.equal(invoke('secret', 'Bearer wrong').statusCode, 401);
});

test('configured bearer authentication accepts the exact token', () => {
  assert.equal(invoke('secret', 'Bearer secret').nextCalled, true);
});

test('read-only requests bypass mutation authentication', () => {
  assert.equal(invoke('secret', undefined, 'GET').nextCalled, true);
});
