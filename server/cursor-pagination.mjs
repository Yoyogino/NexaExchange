export class CursorError extends Error {
  constructor(message = "Pagination cursor is invalid.") {
    super(message);
    this.name = "CursorError";
    this.status = 400;
  }
}

export function encodeCursor(row) {
  if (!row?.createdAt || !row?.id) return null;
  return Buffer.from(JSON.stringify([new Date(row.createdAt).toISOString(), row.id]), "utf8").toString("base64url");
}

export function decodeCursor(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(String(value), "base64url").toString("utf8"));
    if (!Array.isArray(parsed) || parsed.length !== 2 || Number.isNaN(Date.parse(parsed[0])) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(parsed[1])) throw new Error();
    return { createdAt: new Date(parsed[0]).toISOString(), id: parsed[1] };
  } catch {
    throw new CursorError();
  }
}

export function cursorPage(rows, limit) {
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  return { items, nextCursor: hasMore ? encodeCursor(items.at(-1)) : null, hasMore };
}
