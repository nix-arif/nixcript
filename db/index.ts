import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

const sql = neon(process.env.DATABASE_URL!, {
  fetchOptions: {
    timeout: 30000, // 30 seconds per query
  },
});

export const db = drizzle({ client: sql });
