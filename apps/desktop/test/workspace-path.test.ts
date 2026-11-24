import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { isPathInside } from "../src/main/workspace-path";

test("allows the selected workspace root and descendants", () => {
  const root = resolve("/tmp/battlebuket-project");
  assert.equal(isPathInside(root, root), true);
  assert.equal(isPathInside(root, resolve(root, "src/index.ts")), true);
});

test("rejects parent and sibling paths", () => {
  const root = resolve("/tmp/battlebuket-project");
  assert.equal(isPathInside(root, resolve("/tmp")), false);
  assert.equal(isPathInside(root, resolve("/tmp/another-project/secrets.txt")), false);
});
