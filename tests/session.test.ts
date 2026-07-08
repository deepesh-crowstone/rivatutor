import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

let tempDir = "";
let prisma: PrismaClient;

function createTestPrisma(dbPath: string) {
  const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
  return new PrismaClient({ adapter });
}

async function pushSchema(client: PrismaClient) {
  await client.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS LearnerProfile (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      name TEXT,
      selfDeclaredLevel TEXT,
      intentRaw TEXT,
      intentSummary TEXT,
      intentGoalContexts TEXT NOT NULL DEFAULT '[]',
      intentMotivation TEXT,
      intentClarityStatus TEXT NOT NULL DEFAULT 'unknown',
      intentProbeCount INTEGER NOT NULL DEFAULT 0,
      userInterests TEXT NOT NULL DEFAULT '[]',
      extractedKeyFacts TEXT NOT NULL DEFAULT '[]',
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await client.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ChatMessage (
      id TEXT PRIMARY KEY,
      learnerId TEXT NOT NULL,
      topicId TEXT,
      role TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'chat',
      content TEXT NOT NULL,
      metadata TEXT,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

describe("multi-user persistence", () => {
  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "riva-session-"));
    const dbPath = path.join(tempDir, "test.db");
    prisma = createTestPrisma(dbPath);
    await pushSchema(prisma);
  });

  afterEach(async () => {
    await prisma.$disconnect();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates separate profiles per username", async () => {
    const alice = await prisma.learnerProfile.create({
      data: { username: "alice", name: "Alice" },
    });
    const bob = await prisma.learnerProfile.create({
      data: { username: "bob", name: "Bob" },
    });

    expect(alice.id).not.toBe(bob.id);

    const found = await prisma.learnerProfile.findUnique({ where: { username: "alice" } });
    expect(found?.name).toBe("Alice");
  });

  it("preserves messages per username after sign-out simulation", async () => {
    const learner = await prisma.learnerProfile.create({
      data: { username: "dipesh", name: "Deepesh" },
    });

    await prisma.chatMessage.create({
      data: {
        learnerId: learner.id,
        role: "user",
        kind: "chat",
        content: "Hello Riva",
      },
    });

    const messageCount = await prisma.chatMessage.count({ where: { learnerId: learner.id } });
    expect(messageCount).toBe(1);

    const reloaded = await prisma.learnerProfile.findUnique({ where: { username: "dipesh" } });
    const messages = await prisma.chatMessage.findMany({ where: { learnerId: reloaded!.id } });
    expect(messages[0]?.content).toBe("Hello Riva");
  });

  it("lookup uses normalized lowercase username", async () => {
    await prisma.learnerProfile.create({
      data: { username: "dipesh", name: "Deepesh" },
    });

    const found = await prisma.learnerProfile.findUnique({ where: { username: "dipesh" } });
    expect(found?.name).toBe("Deepesh");
  });
});
