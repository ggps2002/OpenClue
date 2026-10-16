import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const serverRoot = path.resolve(__dirname, '..');
const testDb = path.join(serverRoot, 'prisma', 'test.db');

/** Builds a fresh SQLite test database from the Prisma schema before the suite runs. */
export default function setup(): void {
  for (const file of [testDb, `${testDb}-journal`]) fs.rmSync(file, { force: true });
  execSync('npx prisma db push --skip-generate', {
    cwd: serverRoot,
    env: { ...process.env, DATABASE_URL: 'file:./test.db' },
    stdio: 'pipe',
  });
}
