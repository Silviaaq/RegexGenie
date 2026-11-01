import test from "node:test";
import assert from "node:assert/strict";
import { utf16 } from "../frontend/utils.js";
import { EXAMPLES } from "../frontend/data.js";
test("Python code point offsets map to JS UTF-16 slices", () => {
  const s = "😀 hi a@b.com";
  assert.equal(s.slice(utf16(s, 5), utf16(s, 12)), "a@b.com");
});
test("Examples contain instruction text only, never executable rules", () => {
  for (const example of EXAMPLES)
    assert.deepEqual(Object.keys(example).sort(), ["instruction", "label"]);
});
