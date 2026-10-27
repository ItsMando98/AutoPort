import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = path.dirname(fileURLToPath(import.meta.url));

export function resolveDatabasePath(env: NodeJS.ProcessEnv = process.env): string {
  return env.PORTFOLIO_DB_PATH
    ? path.resolve(env.PORTFOLIO_DB_PATH)
    : path.join(serverDir, '..', 'data', 'portfolio.db');
}
