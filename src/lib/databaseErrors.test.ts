import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPoolBusyStatusPayload, isPrismaConnectionPoolTimeout } from "./databaseErrors";

function p2024Error() {
  return Object.assign(new Error("Timed out fetching a new connection from the connection pool."), {
    code: "P2024",
    meta: {
      modelName: "User",
      connection_limit: 33,
      timeout: 10,
    },
  });
}

describe("Prisma pool timeout handling", () => {
  it("detects P2024 connection pool timeouts", () => {
    assert.equal(isPrismaConnectionPoolTimeout(p2024Error()), true);
    assert.equal(isPrismaConnectionPoolTimeout(new Error("ordinary failure")), false);
  });

  it("returns a clean status-polling payload without exposing stack traces", () => {
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...values: unknown[]) => warnings.push(values.join(" "));

    try {
      const payload = buildPoolBusyStatusPayload(p2024Error(), { context: "/api/sync/status", model: "User" });
      assert.equal(payload.status, "busy");
      assert.equal(payload.poolBusy, true);
      assert.match(payload.warning, /Database connection pool is currently busy/);
      assert.doesNotMatch(JSON.stringify(payload), /PrismaClientKnownRequestError|stack/i);
      assert.match(warnings.join("\n"), /model=User limit=33 timeout=10s/);
    } finally {
      console.warn = originalWarn;
    }
  });
});
