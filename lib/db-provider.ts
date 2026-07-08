/**
 * Runtime SQLite vs PostgreSQL selection. Keep scripts/resolve-db-provider.mjs in sync.
 */
function isOnRailway(env: NodeJS.ProcessEnv): boolean {
  return Boolean(
    env.RAILWAY_ENVIRONMENT_NAME ||
      env.RAILWAY_PROJECT_ID ||
      env.RAILWAY_SERVICE_ID ||
      env.RAILWAY_ENVIRONMENT,
  );
}

function isEphemeralDevSqliteUrl(databaseUrl: string): boolean {
  return (
    databaseUrl === "file:./dev.db" ||
    databaseUrl === "file:dev.db" ||
    /file:\.?\/dev\.db$/i.test(databaseUrl)
  );
}

export function resolveUsePostgres(env: NodeJS.ProcessEnv = process.env): boolean {
  const databaseUrl = env.DATABASE_URL ?? "";
  const forcedProvider = env.PRISMA_PROVIDER?.trim().toLowerCase();
  const onRailway = isOnRailway(env);

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
    if (onRailway && isEphemeralDevSqliteUrl(databaseUrl)) {
      return true;
    }

    return false;
  }

  if (onRailway) {
    return true;
  }

  return false;
}
