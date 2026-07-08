import { spawn } from "node:child_process";
import { resolveUsePostgres } from "./resolve-db-provider.mjs";

function isOnRailway(env = process.env) {
  return Boolean(
    env.RAILWAY_ENVIRONMENT_NAME ||
      env.RAILWAY_PROJECT_ID ||
      env.RAILWAY_SERVICE_ID ||
      env.RAILWAY_ENVIRONMENT,
  );
}

function isEphemeralDevSqliteUrl(databaseUrl) {
  return (
    databaseUrl === "file:./dev.db" ||
    databaseUrl === "file:dev.db" ||
    /file:\.?\/dev\.db$/i.test(databaseUrl)
  );
}

function maskDatabaseUrl(databaseUrl) {
  if (!databaseUrl) {
    return "(not set)";
  }

  if (databaseUrl.startsWith("file:")) {
    return databaseUrl;
  }

  try {
    const parsed = new URL(databaseUrl);
    if (parsed.password) {
      parsed.password = "***";
    }
    return parsed.toString();
  } catch {
    return "(invalid URL)";
  }
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      env: process.env,
      shell: process.platform === "win32",
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} exited with code ${code ?? "unknown"}`));
    });
  });
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  const usePostgres = resolveUsePostgres();
  const onRailway = isOnRailway();

  console.log(
    `[startup] provider=${usePostgres ? "postgresql" : "sqlite"} railway=${onRailway} database=${maskDatabaseUrl(databaseUrl)}`,
  );

  if (onRailway && isEphemeralDevSqliteUrl(databaseUrl)) {
    console.error(
      "[startup] DATABASE_URL is still the local SQLite default (file:./dev.db).",
    );
    console.error(
      "[startup] On Railway, set DATABASE_URL=${{Postgres.DATABASE_URL}} on the web service, then redeploy.",
    );
    process.exit(1);
  }

  if (onRailway && usePostgres && !databaseUrl) {
    console.error("[startup] DATABASE_URL is required on Railway when using PostgreSQL.");
    console.error(
      "[startup] Link a Postgres service and set DATABASE_URL=${{Postgres.DATABASE_URL}} on the web service.",
    );
    process.exit(1);
  }

  await run("node", ["scripts/prepare-database.mjs"]);

  if (usePostgres && databaseUrl) {
    console.log("[startup] Applying Prisma schema with prisma db push...");
    await run("npx", ["prisma", "db", "push"]);
    console.log("[startup] Database schema is up to date.");
  } else if (usePostgres) {
    console.warn("[startup] Skipping prisma db push because DATABASE_URL is not set.");
  }

  console.log("[startup] Starting Next.js...");
  await run("npm", ["run", "start:next"]);
}

main().catch((error) => {
  console.error("[startup] Failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
