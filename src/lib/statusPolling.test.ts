import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nextStatusPollDelayMs } from "./statusPolling";

describe("status polling backoff", () => {
  it("uses server poll hints for normal responses", () => {
    assert.equal(nextStatusPollDelayMs({ data: { pollSeconds: 7 } }), 7000);
  });

  it("polls idle status more slowly than active sync status", () => {
    assert.equal(nextStatusPollDelayMs({ data: { metadata: { isSyncing: true } } }), 10000);
    assert.equal(nextStatusPollDelayMs({ data: { metadata: { isSyncing: false } } }), 30000);
  });

  it("backs off on pool-busy and 503 responses", () => {
    assert.equal(nextStatusPollDelayMs({ data: { poolBusy: true, retryAfterSeconds: 30 }, previousDelayMs: 0 }), 60000);
    assert.equal(nextStatusPollDelayMs({ data: { status: "busy" }, httpStatus: 503, previousDelayMs: 60000 }), 120000);
  });
});
