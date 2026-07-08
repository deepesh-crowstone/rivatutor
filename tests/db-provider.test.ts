import { describe, expect, it } from "vitest";
import { resolveUsePostgres } from "@/lib/db-provider";

describe("resolveUsePostgres", () => {
  it("selects postgres from DATABASE_URL", () => {
    expect(
      resolveUsePostgres({
        DATABASE_URL: "postgresql://user:pass@host:5432/railway",
      } as NodeJS.ProcessEnv),
    ).toBe(true);
  });

  it("selects sqlite from file DATABASE_URL", () => {
    expect(
      resolveUsePostgres({
        DATABASE_URL: "file:./dev.db",
      } as NodeJS.ProcessEnv),
    ).toBe(false);
  });

  it("selects postgres when PRISMA_PROVIDER is postgresql", () => {
    expect(
      resolveUsePostgres({
        PRISMA_PROVIDER: "postgresql",
      } as NodeJS.ProcessEnv),
    ).toBe(true);
  });

  it("defaults to postgres on Railway when DATABASE_URL is missing", () => {
    expect(
      resolveUsePostgres({
        RAILWAY_ENVIRONMENT_NAME: "production",
      } as NodeJS.ProcessEnv),
    ).toBe(true);
  });

  it("defaults to sqlite for local dev without postgres URL", () => {
    expect(resolveUsePostgres({} as NodeJS.ProcessEnv)).toBe(false);
  });
});
