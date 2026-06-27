import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { safeTrackBatchIterator } from "./safeTrackBatch";

function conversionError() {
  return Object.assign(new Error("Failed to convert rust String into napi string"), {
    code: "GenericFailure",
    meta: { modelName: "Track" },
  });
}

describe("safe Track batch loading", () => {
  it("isolates, logs, and quarantines one corrupt row while processing the rest", async () => {
    const calls: any[] = [];
    const quarantined: string[] = [];
    const processed: string[] = [];
    const errors: string[] = [];
    const originalError = console.error;
    console.error = (...values: unknown[]) => errors.push(values.join(" "));

    const client = {
      track: {
        findMany: async (args: any) => {
          calls.push(args);
          if (args.select?.id === true && Object.keys(args.select).length === 1) {
            return [{ id: "good-1" }, { id: "bad" }, { id: "good-2" }];
          }
          const ids: string[] = args.where.id.in;
          if (ids.includes("bad")) throw conversionError();
          return ids.map((id) => ({ id, title: `title-${id}`, ratingKey: id }));
        },
        findUnique: async (args: any) => {
          if (args.where.id === "bad" && args.select.title) throw conversionError();
          if (args.select.libraryId) return { libraryId: "library-1", library: { name: "Music" } };
          if (args.select.ratingKey) return { ratingKey: "plex-bad", plexId: "plex-bad" };
          return { id: args.where.id };
        },
        updateMany: async (args: any) => {
          quarantined.push(args.where.id);
          assert.equal(args.data.syncStatus, "metadata_corrupt");
          return { count: 1 };
        },
      },
    };

    try {
      const result = await safeTrackBatchIterator<any>({
        client,
        engineName: "TestEngine",
        where: { syncStatus: "active" },
        select: { id: true, title: true, ratingKey: true },
        process: async (track) => { processed.push(track.id); },
      });

      assert.deepEqual(result, { attempted: 3, processed: 2, skipped: 1, failed: 0 });
      assert.deepEqual(processed, ["good-1", "good-2"]);
      assert.deepEqual(quarantined, ["bad"]);
      assert.match(errors.join("\n"), /trackId=bad/);
      assert.match(errors.join("\n"), /suspectedField=title/);
      assert.deepEqual(calls[0].select, { id: true });
      assert.ok(calls.slice(1).every((call) => call.select && !call.include));
    } finally {
      console.error = originalError;
    }
  });

  it("keeps enrichment engines free of broad Track findMany calls", () => {
    for (const file of ["audioFeatureEngine.ts", "trackTagEngine.ts", "popularityEngine.ts", "localBpmEngine.ts", "localAudioFeatureEngine.ts"]) {
      const source = readFileSync(join(process.cwd(), "src", "lib", file), "utf8");
      assert.doesNotMatch(source, /prisma\.track\.findMany\s*\(/, file);
      assert.match(source, /safeTrackBatchIterator/, file);
      assert.doesNotMatch(source, /Promise\.all\(\s*\[[\s\S]{0,500}prisma\./, file);
    }
  });
});
