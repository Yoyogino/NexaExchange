// Double-entry ledger for demo balances.
//
// Every balance change is two or more balanced entries in `ledger_entries`,
// grouped by `group_id`. A group must sum to zero for each asset before it
// is written. Account balances are always *derived* by summing entries —
// there is no mutable balance column anywhere, per PRODUCT_REQUIREMENTS.md
// section 4 ("balances are derived from the ledger") and the project's
// non-negotiable: never treat a database column as the source of truth.
//
// Convention: CREDIT increases an account's ledger balance, DEBIT decreases
// it. A user's AVAILABLE/LOCKED accounts are asset-like (normally
// non-negative). SYSTEM_ISSUANCE is the counterparty for demo funding and
// is expected to go negative — that negative number is the total demo
// liability the exchange has "issued", which is intentional for a system
// account and is never shown to users.
//
// This module only knows about accounts and balanced entries. It has no
// idea what an "order" or a "trade" is — server/matching.mjs builds on top
// of `ensureAccount` + `postEntries` to settle trades between two different
// users in one atomic, balance-checked group.

import crypto from "node:crypto";
import * as D from "./decimal.mjs";

export const ASSETS = ["BTC", "USDT"];
export const ACCOUNT_TYPES = ["AVAILABLE", "LOCKED", "SYSTEM_ISSUANCE", "FEE"];

export async function ensureLedgerSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'TRADER' CHECK (role IN ('TRADER','ADMIN')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS ledger_accounts (
      id UUID PRIMARY KEY,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      asset TEXT NOT NULL CHECK (asset IN ('BTC','USDT')),
      account_type TEXT NOT NULL CHECK (account_type IN ('AVAILABLE','LOCKED','SYSTEM_ISSUANCE','FEE')),
      CONSTRAINT ledger_accounts_owner_matches_type CHECK (
        (account_type IN ('AVAILABLE','LOCKED') AND user_id IS NOT NULL)
        OR (account_type IN ('SYSTEM_ISSUANCE','FEE') AND user_id IS NULL)
      ),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- A user may have at most one account per (asset, type). System accounts
    -- (user_id IS NULL) are singletons per (asset, type). Plain UNIQUE can't
    -- express "singleton when NULL" because SQL treats NULLs as distinct, so
    -- we use two partial indexes instead.
    CREATE UNIQUE INDEX IF NOT EXISTS ledger_accounts_user_unique
      ON ledger_accounts (user_id, asset, account_type) WHERE user_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS ledger_accounts_system_unique
      ON ledger_accounts (asset, account_type) WHERE user_id IS NULL;

    CREATE TABLE IF NOT EXISTS ledger_entries (
      id UUID PRIMARY KEY,
      group_id UUID NOT NULL,
      ledger_account_id UUID NOT NULL REFERENCES ledger_accounts(id),
      direction TEXT NOT NULL CHECK (direction IN ('DEBIT','CREDIT')),
      amount NUMERIC(28,8) NOT NULL CHECK (amount > 0),
      reason TEXT NOT NULL,
      related_type TEXT,
      related_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS ledger_entries_account_idx ON ledger_entries (ledger_account_id);
    CREATE INDEX IF NOT EXISTS ledger_entries_group_idx ON ledger_entries (group_id);

    CREATE TABLE IF NOT EXISTS audit_events (
      id UUID PRIMARY KEY,
      actor_user_id UUID REFERENCES users(id),
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      metadata JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Backward-compatible upgrades for databases created before roles and
    -- trading controls existed. These ALTERs preserve existing demo users.
    ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'TRADER' CHECK (role IN ('TRADER','ADMIN'));
    ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
    ALTER TABLE users ADD COLUMN IF NOT EXISTS trading_disabled BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS demo_grant_claimed BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_secret TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_last_counter BIGINT;

    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='ledger_accounts'::regclass AND conname='ledger_accounts_owner_matches_type') THEN
        ALTER TABLE ledger_accounts ADD CONSTRAINT ledger_accounts_owner_matches_type CHECK (
          (account_type IN ('AVAILABLE','LOCKED') AND user_id IS NOT NULL)
          OR (account_type IN ('SYSTEM_ISSUANCE','FEE') AND user_id IS NULL)
        );
      END IF;
    END $$;

    -- Stable keyset-pagination paths used by the admin panel. Including the
    -- UUID tie-breaker avoids a sort when multiple rows share a timestamp.
    CREATE INDEX IF NOT EXISTS users_admin_cursor_idx ON users (created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS audit_events_admin_cursor_idx ON audit_events (created_at DESC, id DESC);

    CREATE OR REPLACE FUNCTION reject_ledger_mutation()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'ledger history is append-only' USING ERRCODE = '55000';
    END;
    $$;

    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='ledger_entries'::regclass AND tgname='ledger_entries_immutable') THEN
        CREATE TRIGGER ledger_entries_immutable
        BEFORE UPDATE OR DELETE ON ledger_entries
        FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='ledger_accounts'::regclass AND tgname='ledger_accounts_immutable') THEN
        CREATE TRIGGER ledger_accounts_immutable
        BEFORE UPDATE OR DELETE ON ledger_accounts
        FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
      END IF;
    END $$;

    CREATE OR REPLACE FUNCTION reject_audit_event_mutation()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'audit history is append-only' USING ERRCODE = '55000';
    END;
    $$;

    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='audit_events'::regclass AND tgname='audit_events_immutable') THEN
        CREATE TRIGGER audit_events_immutable
        BEFORE UPDATE OR DELETE ON audit_events
        FOR EACH ROW EXECUTE FUNCTION reject_audit_event_mutation();
      END IF;
    END $$;
  `);
}

/** Thrown for ledger-level admin errors, e.g. debiting more than a user has available. */
export class LedgerError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "LedgerError";
    this.status = status;
  }
}

/** Get or create a ledger account. `userId` null means a system account. */
export async function ensureAccount(client, { userId = null, asset, accountType }) {
  if (!ASSETS.includes(asset)) throw new Error(`Unknown asset: ${asset}`);
  if (!ACCOUNT_TYPES.includes(accountType)) throw new Error(`Unknown account type: ${accountType}`);
  const existing = userId
    ? await client.query(
        "SELECT id FROM ledger_accounts WHERE user_id = $1 AND asset = $2 AND account_type = $3",
        [userId, asset, accountType],
      )
    : await client.query(
        "SELECT id FROM ledger_accounts WHERE user_id IS NULL AND asset = $1 AND account_type = $2",
        [asset, accountType],
      );
  if (existing.rows[0]) return existing.rows[0].id;
  const id = crypto.randomUUID();
  const created = userId
    ? await client.query(
        `INSERT INTO ledger_accounts (id, user_id, asset, account_type) VALUES ($1,$2,$3,$4)
         ON CONFLICT (user_id, asset, account_type) WHERE user_id IS NOT NULL DO NOTHING RETURNING id`,
        [id, userId, asset, accountType],
      )
    : await client.query(
        `INSERT INTO ledger_accounts (id, user_id, asset, account_type) VALUES ($1,NULL,$2,$3)
         ON CONFLICT (asset, account_type) WHERE user_id IS NULL DO NOTHING RETURNING id`,
        [id, asset, accountType],
      );
  if (created.rows[0]) return created.rows[0].id;

  // Another transaction won the creation race. Its unique-index entry is
  // visible after ON CONFLICT waits for that transaction to finish.
  const winner = userId
    ? await client.query("SELECT id FROM ledger_accounts WHERE user_id = $1 AND asset = $2 AND account_type = $3", [userId, asset, accountType])
    : await client.query("SELECT id FROM ledger_accounts WHERE user_id IS NULL AND asset = $1 AND account_type = $2", [asset, accountType]);
  if (!winner.rows[0]) throw new Error("Ledger account creation did not produce an account.");
  return winner.rows[0].id;
}

/**
 * Post a balanced group of ledger entries inside the caller's transaction.
 * `entries`: [{ accountId, asset, direction: 'DEBIT'|'CREDIT', amount, reason, relatedType?, relatedId? }]
 * Throws if the group does not sum to zero for any asset that appears in it
 * — this is the ledger's core invariant, enforced in code before a single
 * row is written, not just trusted of the caller. Entries may reference
 * accounts belonging to different users (this is how a trade between a
 * buyer and a seller is one atomic, balanced group).
 */
export async function postEntries(client, entries) {
  if (entries.length < 2) throw new Error("A ledger group needs at least two entries.");
  const byAsset = new Map();
  for (const entry of entries) {
    if (!ASSETS.includes(entry.asset)) throw new Error(`Unknown ledger-entry asset: ${entry.asset}.`);
    if (!["DEBIT", "CREDIT"].includes(entry.direction)) throw new Error(`Unknown ledger direction: ${entry.direction}.`);
    const amount = D.parse(entry.amount);
    if (!D.isPositive(amount)) throw new Error("Ledger entry amounts must be greater than zero.");
    const signed = entry.direction === "CREDIT" ? amount : -amount;
    byAsset.set(entry.asset, D.add(byAsset.get(entry.asset) ?? D.ZERO, signed));
  }
  for (const [asset, total] of byAsset) {
    if (!D.isZero(total)) {
      throw new Error(`Ledger group does not balance for ${asset} (off by ${D.format(total)}).`);
    }
  }

  const accountIds = [...new Set(entries.map((entry) => entry.accountId))];
  // Lock in a deterministic order so concurrent postings cannot both spend
  // the same balance and multi-account trades cannot deadlock each other.
  const accounts = await client.query(
    "SELECT id, asset, user_id, account_type FROM ledger_accounts WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE",
    [accountIds],
  );
  const accountById = new Map(accounts.rows.map((row) => [row.id, row]));
  for (const entry of entries) {
    const account = accountById.get(entry.accountId);
    if (!account) throw new Error(`Ledger account does not exist: ${entry.accountId}.`);
    if (account.asset !== entry.asset) throw new Error(`Ledger account ${entry.accountId} belongs to ${account.asset}, not ${entry.asset}.`);
  }

  const existing = await client.query(
    `SELECT ledger_account_id AS id,
            SUM(CASE WHEN direction = 'CREDIT' THEN amount ELSE -amount END) AS balance
     FROM ledger_entries WHERE ledger_account_id = ANY($1::uuid[]) GROUP BY ledger_account_id`,
    [accountIds],
  );
  const balances = new Map(existing.rows.map((row) => [row.id, D.parse(row.balance)]));
  const changes = new Map();
  for (const entry of entries) {
    const amount = D.parse(entry.amount);
    const signed = entry.direction === "CREDIT" ? amount : -amount;
    changes.set(entry.accountId, D.add(changes.get(entry.accountId) ?? D.ZERO, signed));
  }
  for (const [accountId, change] of changes) {
    const account = accountById.get(accountId);
    if (account.user_id && ["AVAILABLE", "LOCKED"].includes(account.account_type)) {
      const nextBalance = D.add(balances.get(accountId) ?? D.ZERO, change);
      if (nextBalance < D.ZERO) {
        throw new LedgerError(`Insufficient ${account.asset} ${account.account_type.toLowerCase()} balance.`, 402);
      }
    }
  }

  const groupId = crypto.randomUUID();
  for (const entry of entries) {
    await client.query(
      `INSERT INTO ledger_entries (id, group_id, ledger_account_id, direction, amount, reason, related_type, related_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        crypto.randomUUID(),
        groupId,
        entry.accountId,
        entry.direction,
        entry.amount,
        entry.reason,
        entry.relatedType ?? null,
        entry.relatedId ?? null,
      ],
    );
  }
  return groupId;
}

/**
 * Fund a user's AVAILABLE balance from the system issuance account. This is
 * the only source of demo money — it makes the "these are simulated funds"
 * promise auditable instead of just a UI label.
 */
export async function fundDemoBalance(client, { userId, asset, amount, reason }) {
  const userAccountId = await ensureAccount(client, { userId, asset, accountType: "AVAILABLE" });
  const systemAccountId = await ensureAccount(client, { asset, accountType: "SYSTEM_ISSUANCE" });
  return postEntries(client, [
    { accountId: systemAccountId, asset, direction: "DEBIT", amount, reason, relatedType: "user", relatedId: userId },
    { accountId: userAccountId, asset, direction: "CREDIT", amount, reason, relatedType: "user", relatedId: userId },
  ]);
}

/** Move funds between two of a user's own accounts (e.g. AVAILABLE -> LOCKED when an order is placed). */
export async function transferWithinUser(client, { userId, asset, amount, fromType, toType, reason, relatedType, relatedId }) {
  const fromAccountId = await ensureAccount(client, { userId, asset, accountType: fromType });
  const toAccountId = await ensureAccount(client, { userId, asset, accountType: toType });
  return postEntries(client, [
    { accountId: fromAccountId, asset, direction: "DEBIT", amount, reason, relatedType, relatedId },
    { accountId: toAccountId, asset, direction: "CREDIT", amount, reason, relatedType, relatedId },
  ]);
}

/**
 * Admin-initiated balance adjustment — ledger-backed like every other
 * balance change, never a silent edit (there is no balance column to edit).
 * A positive `amount` credits the user's AVAILABLE balance from system
 * issuance, same shape as fundDemoBalance. A negative amount debits it back
 * to system issuance, but only after confirming the user's *available*
 * balance actually covers it — funds already LOCKED in a resting order are
 * untouched, so an admin adjustment can never pull the rug out from under
 * an order that's still on the book. `actorUserId` is accepted for callers
 * that want it in scope for their own audit-logging call; this function
 * doesn't record an audit event itself, since it doesn't know whether the
 * caller already opened a transaction for one.
 */
export async function adjustBalance(client, { userId, asset, amount, reason, actorUserId }) {
  const scaled = D.parse(amount);
  if (D.isZero(scaled)) throw new LedgerError("Adjustment amount cannot be zero.", 400);
  const magnitude = scaled < 0n ? -scaled : scaled;
  const magnitudeStr = D.format(magnitude);

  const userAccountId = await ensureAccount(client, { userId, asset, accountType: "AVAILABLE" });
  const systemAccountId = await ensureAccount(client, { asset, accountType: "SYSTEM_ISSUANCE" });

  if (scaled > 0n) {
    return postEntries(client, [
      { accountId: systemAccountId, asset, direction: "DEBIT", amount: magnitudeStr, reason, relatedType: "admin_adjustment", relatedId: userId },
      { accountId: userAccountId, asset, direction: "CREDIT", amount: magnitudeStr, reason, relatedType: "admin_adjustment", relatedId: userId },
    ]);
  }

  const balances = await getBalances(client, userId);
  const current = balances.find((b) => b.asset === asset);
  const availableScaled = D.parse(current?.availableBalance ?? "0");
  if (availableScaled < magnitude) {
    throw new LedgerError(
      `Cannot debit ${magnitudeStr} ${asset}: available balance is only ${current?.availableBalance ?? "0"}.`,
      402,
    );
  }
  return postEntries(client, [
    { accountId: userAccountId, asset, direction: "DEBIT", amount: magnitudeStr, reason, relatedType: "admin_adjustment", relatedId: userId },
    { accountId: systemAccountId, asset, direction: "CREDIT", amount: magnitudeStr, reason, relatedType: "admin_adjustment", relatedId: userId },
  ]);
}

export async function recordAudit(client, { actorUserId = null, action, targetType = null, targetId = null, metadata = null }) {
  await client.query(
    "INSERT INTO audit_events (id, actor_user_id, action, target_type, target_id, metadata) VALUES ($1,$2,$3,$4,$5,$6)",
    [crypto.randomUUID(), actorUserId, action, targetType, targetId, metadata ? JSON.stringify(metadata) : null],
  );
}

/**
 * Balances for one user, derived from ledger_entries — never a stored column.
 * Accepts a Pool or a transaction Client (anything with `.query`); pass the
 * same Client you posted entries on if you need to read them uncommitted.
 */
export async function getBalances(db, userId) {
  const result = await db.query(
    `SELECT
       la.asset,
       la.account_type AS "accountType",
       COALESCE(SUM(CASE WHEN le.direction = 'CREDIT' THEN le.amount ELSE -le.amount END), 0) AS balance
     FROM ledger_accounts la
     LEFT JOIN ledger_entries le ON le.ledger_account_id = la.id
     WHERE la.user_id = $1 AND la.account_type IN ('AVAILABLE','LOCKED')
     GROUP BY la.asset, la.account_type
     ORDER BY la.asset, la.account_type`,
    [userId],
  );
  const byAsset = new Map();
  for (const asset of ASSETS) byAsset.set(asset, { asset, availableBalance: "0", lockedBalance: "0" });
  for (const row of result.rows) {
    const entry = byAsset.get(row.asset);
    if (!entry) continue;
    if (row.accountType === "AVAILABLE") entry.availableBalance = row.balance;
    if (row.accountType === "LOCKED") entry.lockedBalance = row.balance;
  }
  return [...byAsset.values()];
}
