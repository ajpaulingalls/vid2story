import type { Config } from 'drizzle-kit';

export default {
  schema: './src/models/schema.ts',
  out: './src/models/migrations',
  dialect: 'sqlite',
  dbCredentials: {
    url: 'sqlite.db'
  },
} satisfies Config; 