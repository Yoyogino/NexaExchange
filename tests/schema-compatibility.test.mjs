import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("legacy user databases receive every column required by admin queries", async () => {
  const source = await readFile(new URL("../server/ledger.mjs", import.meta.url), "utf8");
  for (const column of ["role", "created_at", "trading_disabled", "demo_grant_claimed", "email_verified", "two_factor_secret", "two_factor_enabled", "two_factor_last_counter"]) {
    assert.match(source, new RegExp(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ${column}\\b`));
  }
});

test("protected migration initializes the advanced-order schema", async () => {
  const source = await readFile(new URL("../server/initialize-schema.mjs", import.meta.url), "utf8");
  assert.match(source, /import \{ ensureAdvancedOrdersSchema \} from "\.\/advanced-orders\.mjs";/);
  assert.match(source, /await ensureAdvancedOrdersSchema\(pool\);/);
});
