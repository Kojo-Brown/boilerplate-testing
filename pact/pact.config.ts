import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const PACT_CONSUMER = 'boilerplate-consumer';
export const PACT_PROVIDER = 'boilerplate-api';
export const PACT_DIR = resolve(__dirname, '..', 'pacts');
export const PACT_LOG_LEVEL = 'warn' as const;

export const PACT_PROVIDER_BASE_URL =
  process.env['PROVIDER_BASE_URL'] ?? 'http://localhost:3000';
