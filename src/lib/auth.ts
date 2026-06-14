import { betterAuth } from 'better-auth';
import { Pool } from 'pg';
import { openAPI } from 'better-auth/plugins';
import 'dotenv/config';

export const auth = betterAuth({
  database: new Pool({
    connectionString: process.env.DATABASE_URL,
  }),
  emailAndPassword: {
    enabled: true,
  },
  trustedOrigins: ['http://localhost:3000', 'http://localhost:4000'],
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  plugins: [openAPI()],
});
