import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

// src/config -> server, or dist/src/config -> server/dist when compiled.
const twoUp = path.resolve(__dirname, '..', '..');
const packageRoot = path.basename(twoUp) === 'dist' ? path.dirname(twoUp) : twoUp;

dotenv.config({ path: path.join(packageRoot, '.env') });

const DEV_JWT_SECRET = 'openclue-dev-secret';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().default('file:./dev.db'),
  JWT_SECRET: z.string().min(1).default(DEV_JWT_SECRET),
  STORAGE_DIR: z.string().default('storage'),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(500),
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default('claude-sonnet-5-5'),
  OPENAI_API_KEY: z.string().optional(),
});

function loadEnv() {
  const parsed = schema.parse(process.env);
  if (parsed.NODE_ENV === 'production' && parsed.JWT_SECRET === DEV_JWT_SECRET) {
    throw new Error('JWT_SECRET must be set in production');
  }
  const isTest = parsed.NODE_ENV === 'test';
  return {
    ...parsed,
    packageRoot,
    storageDir: path.resolve(packageRoot, parsed.STORAGE_DIR),
    clientDistDir: path.resolve(packageRoot, '..', 'client', 'dist'),
    // Tests always run offline, even if keys are present in the environment.
    anthropicApiKey: isTest ? undefined : parsed.ANTHROPIC_API_KEY || undefined,
    openaiApiKey: isTest ? undefined : parsed.OPENAI_API_KEY || undefined,
  };
}

export type Env = ReturnType<typeof loadEnv>;
export const env: Env = loadEnv();
