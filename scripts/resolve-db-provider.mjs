/**
 * Shared SQLite vs PostgreSQL selection for build scripts and runtime.
 * Keep lib/db-provider.ts in sync with this file.
 */
export function resolveUsePostgres(env = process.env) {
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

  // Railway builds/deploys should use PostgreSQL even before DATABASE_URL is linked.
  if (onRailway) {
    return true;
  }

  return false;
}
