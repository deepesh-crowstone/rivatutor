import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = path.join(root, "prisma/schema.prisma");
const sqliteTemplate = path.join(root, "prisma/schema.sqlite.prisma");
const postgresTemplate = path.join(root, "prisma/schema.postgresql.prisma");

const databaseUrl = process.env.DATABASE_URL ?? "";
const usePostgres =
  databaseUrl.startsWith("postgres://") || databaseUrl.startsWith("postgresql://");

const source = usePostgres ? postgresTemplate : sqliteTemplate;

if (!fs.existsSync(source)) {
  console.log(
    `[prepare-database] No ${usePostgres ? "PostgreSQL" : "SQLite"} template found; keeping prisma/schema.prisma`,
  );
  process.exit(0);
}

fs.copyFileSync(source, schemaPath);
console.log(`[prepare-database] Using ${usePostgres ? "PostgreSQL" : "SQLite"} Prisma schema`);
