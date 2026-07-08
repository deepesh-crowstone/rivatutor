/**
 * Runtime SQLite vs PostgreSQL selection. Keep scripts/resolve-db-provider.mjs in sync.
 */
export function resolveUsePostgres(env: NodeJS.ProcessEnv = process.env): boolean {
  const databaseUrl = env.DATABASE_URL ?? "";
  const forcedProvider = env.PRISMA_PROVIDER?.trim().toLowerCase();
  const onRailway = Boolean(env.RAILWAY_ENVIRONMENT);

  if (forcedProvider === "postgresql" || forcedProvider === "postgres") {
    return true;
  }

  if (forcedProvider === "sqlite") {
    return false;
  }

  if (databaseUrl.startsWith("postgres://") || databaseUrl.startsWith("postgresql://")) {
    return true;
  }

  if (databaseUrl.startsWith("file:")) {
    return false;
  }

  if (onRailway) {
    return true;
  }

  return false;
}
