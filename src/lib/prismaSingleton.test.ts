import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "node:test";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (["node_modules", ".next", ".test-dist", ".git"].includes(entry.name)) return [];
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(fullPath);
    if (!/\.(ts|tsx|js|jsx)$/.test(entry.name)) return [];
    return [fullPath];
  });
}

describe("Prisma singleton", () => {
  it("keeps PrismaClient construction isolated to src/lib/prisma.ts", () => {
    const root = process.cwd();
    const offenders = sourceFiles(root)
      .filter((file) => /new\s+PrismaClient\s*\(/.test(readFileSync(file, "utf8")))
      .map((file) => relative(root, file).replace(/\\/g, "/"));

    assert.deepEqual(offenders, ["src/lib/prisma.ts"]);
  });

  it("uses a global singleton in the shared Prisma helper", () => {
    const source = readFileSync(join(process.cwd(), "src", "lib", "prisma.ts"), "utf8");
    assert.match(source, /globalThis\.prismaGlobal/);
    assert.match(source, /export default prisma/);
    assert.ok(statSync(join(process.cwd(), "src", "lib", "prisma.ts")).isFile());
  });
});
