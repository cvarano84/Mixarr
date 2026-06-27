import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sanitizeMetadataString } from "./metadataSanitizer";

describe("metadata string sanitizer", () => {
  it("preserves ASCII, Unicode, and emoji", () => {
    assert.equal(sanitizeMetadataString("Plain title"), "Plain title");
    assert.equal(sanitizeMetadataString("Beyonc\u00e9 \u2014 D\u00e9j\u00e0 vu"), "Beyonc\u00e9 \u2014 D\u00e9j\u00e0 vu");
    assert.equal(sanitizeMetadataString("Music \ud83c\udfb5"), "Music \ud83c\udfb5");
  });

  it("removes null bytes and replaces control characters", () => {
    assert.equal(sanitizeMetadataString("bad\u0000title"), "badtitle");
    assert.equal(sanitizeMetadataString("bad\u0001title\u007f"), "bad title ");
  });

  it("replaces lone UTF-16 surrogates without damaging valid pairs", () => {
    assert.equal(sanitizeMetadataString("bad\ud800value"), "bad\ufffdvalue");
    assert.equal(sanitizeMetadataString("bad\udc00value"), "bad\ufffdvalue");
    assert.equal(sanitizeMetadataString("ok\ud83d\ude00"), "ok\ud83d\ude00");
  });
});
