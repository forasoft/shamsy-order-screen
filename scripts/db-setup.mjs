// Applies the schema and the seed to DATABASE_URL.
//   node scripts/db-setup.mjs            -> schema (if missing) + seed
//   node scripts/db-setup.mjs --reset    -> drop schema shamsy first (local/testing only)
import pg from "pg";
import { readFileSync } from "node:fs";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL is not set"); process.exit(1); }
const client = new pg.Client({ connectionString: url, ssl: url.includes("localhost") || url.includes("127.0.0.1") ? false : { rejectUnauthorized: false } });
await client.connect();
if (process.argv.includes("--reset")) {
  await client.query("drop schema if exists shamsy cascade");
  console.log("dropped schema shamsy");
}
const { rows } = await client.query("select to_regclass('shamsy.orders') is not null as exists");
if (!rows[0].exists) {
  await client.query(readFileSync(new URL("../db/migrations/001_schema.sql", import.meta.url), "utf8"));
  console.log("applied 001_schema.sql");
}
await client.query(readFileSync(new URL("../db/seed.sql", import.meta.url), "utf8"));
console.log("seeded");
await client.end();
