import type { Pool } from "pg";
import type { PrismaClient } from "@/generated/prisma/client";
import { PrismaClient as PrismaClientConstructor } from "@/generated/prisma/client";
import { resolveUsePostgres } from "@/lib/db-provider";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  pgPool?: Pool;
};

function createPrismaClient(): PrismaClient {
  const usePostgres = resolveUsePostgres();
  const url = process.env.DATABASE_URL;
  const log: ("error" | "warn")[] =
    process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"];

  if (usePostgres) {
    if (!url) {
      throw new Error(
        "DATABASE_URL is required for PostgreSQL deployments. Link a Postgres service on Railway or set DATABASE_URL.",
      );
    }

    if (!url.startsWith("postgres://") && !url.startsWith("postgresql://")) {
      throw new Error(
        "DATABASE_URL must be a PostgreSQL connection string on Railway. Set DATABASE_URL=${{Postgres.DATABASE_URL}} in Railway Variables.",
      );
    }

    const { PrismaPg } = require("@prisma/adapter-pg") as typeof import("@prisma/adapter-pg");
    const { Pool: PgPool } = require("pg") as typeof import("pg");

    const pool = globalForPrisma.pgPool ?? new PgPool({ connectionString: url });
    if (process.env.NODE_ENV !== "production") {
      globalForPrisma.pgPool = pool;
    }

    const adapter = new PrismaPg(pool);
    return new PrismaClientConstructor({ adapter, log });
  }

  const sqliteUrl = url ?? "file:./dev.db";
  const { PrismaBetterSqlite3 } =
    require("@prisma/adapter-better-sqlite3") as typeof import("@prisma/adapter-better-sqlite3");
  const adapter = new PrismaBetterSqlite3({ url: sqliteUrl });
  return new PrismaClientConstructor({ adapter, log });
}

function getPrismaClient(): PrismaClient {
  if (globalForPrisma.prisma) {
    return globalForPrisma.prisma;
  }

  const client = createPrismaClient();
  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prisma = client;
  }

  return client;
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const client = getPrismaClient();
    const value = Reflect.get(client, prop, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
