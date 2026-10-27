import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { resolveDatabasePath } from '../server/dbPath.js';

test('explicit portfolio database path overrides the production database', () => {
  assert.equal(
    resolveDatabasePath({ PORTFOLIO_DB_PATH: '/tmp/portfolio-test.db' }),
    '/tmp/portfolio-test.db',
  );
});

test('default database remains data/portfolio.db', () => {
  assert.equal(resolveDatabasePath({}).endsWith(path.join('data', 'portfolio.db')), true);
});
