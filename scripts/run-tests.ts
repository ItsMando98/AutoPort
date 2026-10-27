import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const testRoot = mkdtempSync(path.join(tmpdir(), 'autonomous-portfolio-tests-'));
const databasePath = path.join(testRoot, 'portfolio.test.db');
const requestedFiles = process.argv.slice(2);
const testFiles = requestedFiles.length > 0
  ? requestedFiles
  : readdirSync(path.join(process.cwd(), 'tests'))
    .filter(file => file.endsWith('.test.ts'))
    .sort()
    .map(file => path.join('tests', file));

try {
  const result = spawnSync(
    path.join(process.cwd(), 'node_modules', '.bin', 'tsx'),
    ['--test', '--test-concurrency=1', ...testFiles],
    {
      cwd: process.cwd(),
      env: { ...process.env, PORTFOLIO_DB_PATH: databasePath },
      stdio: 'inherit',
    },
  );

  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(testRoot, { recursive: true, force: true });
}
