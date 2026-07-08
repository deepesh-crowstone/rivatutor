import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveUsePostgres } from "./resolve-db-provider.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = path.join(root, "prisma/schema.prisma");
const sqliteTemplate = path.join(root, "prisma/schema.sqlite.prisma");
const postgresTemplate = path.join(root, "prisma/schema.postgresql.prisma");

function loadEnvFile(filename) {
  const envPath = path.join(root, filename);
  if (!fs.existsSync(envPath)) {
    return;
  }

  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadEnvFile(".env");
loadEnvFile(".env.local");

const usePostgres = resolveUsePostgres();
const source = usePostgres ? postgresTemplate : sqliteTemplate;

if (!fs.existsSync(source)) {
  console.log(
    `[prepare-database] No ${usePostgres ? "PostgreSQL" : "SQLite"} template found; keeping prisma/schema.prisma`,
  );
  process.exit(0);
}

fs.copyFileSync(source, schemaPath);
console.log(`[prepare-database] Using ${usePostgres ? "PostgreSQL" : "SQLite"} Prisma schema`);
