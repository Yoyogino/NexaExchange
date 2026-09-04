import assert from "node:assert/strict";
import test from "node:test";
import { cursorPage, decodeCursor, encodeCursor } from "../server/cursor-pagination.mjs";

test("pagination cursors round-trip a stable created-time and ID boundary", () => {
  const row = { id: "550e8400-e29b-41d4-a716-446655440000", createdAt: "2026-09-03T12:00:00.000Z" };
  assert.deepEqual(decodeCursor(encodeCursor(row)), { id: row.id, createdAt: row.createdAt });
});

test("cursor pages expose one bounded next cursor without leaking row data", () => {
  const rows = [
    { id: "550e8400-e29b-41d4-a716-446655440001", createdAt: "2026-09-03T12:00:02.000Z" },
    { id: "550e8400-e29b-41d4-a716-446655440002", createdAt: "2026-09-03T12:00:01.000Z" },
  ];
  const page = cursorPage(rows, 1);
  assert.equal(page.items.length, 1);
  assert.equal(page.hasMore, true);
  assert.ok(page.nextCursor);
  assert.equal(page.nextCursor.includes(rows[0].id), false);
});

test("malformed pagination cursors fail with a client error", () => {
  assert.throws(() => decodeCursor("not-a-cursor"), (error) => error.status === 400);
});
