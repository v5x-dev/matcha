import { defineConfig } from 'drizzle-kit';

const databaseUrl = process.env.DATABASE_URL;
const tursoAuthToken = process.env.TURSO_AUTH_TOKEN;

if (!databaseUrl) throw new Error('DATABASE_URL is not set');

export default defineConfig(
	tursoAuthToken
		? {
					schema: './src/lib/server/db/schema.ts',
					dialect: 'turso',
					dbCredentials: { url: databaseUrl, authToken: tursoAuthToken },
					verbose: true,
					strict: true
				}
			: {
					schema: './src/lib/server/db/schema.ts',
					dialect: 'sqlite',
					dbCredentials: { url: databaseUrl },
					verbose: true,
					strict: true
				}
);
