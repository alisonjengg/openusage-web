import "server-only";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { env } from "./env";
import {
  accountEntryFromRow,
  accountSummaryFromRow,
  type AccountEntry,
  type StoredAccountRow,
} from "./account-row";
import { deriveKey, openJSON, sealJSON } from "./crypto";
import { isCompleteIdOrder } from "./reorder";
import type {
  AccountRecord,
  AccountSecret,
  AccountSummary,
  ProviderId,
} from "./providers/types";

let _db: DatabaseSync | null = null;

function db(): DatabaseSync {
  if (_db) return _db;
  mkdirSync(dirname(env.databasePath), { recursive: true });
  const conn = new DatabaseSync(env.databasePath);
  conn.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id          TEXT PRIMARY KEY,
      provider    TEXT NOT NULL,
      label       TEXT NOT NULL,
      secret_blob BLOB NOT NULL,
      iv          BLOB NOT NULL,
      sort_order  INTEGER NOT NULL,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    );
  `);
  ensureAccountOrderColumn(conn);
  _db = conn;
  return conn;
}

const key = () => deriveKey(env.secret);

type ColumnInfo = { name: string };

function ensureAccountOrderColumn(conn: DatabaseSync): void {
  const cols = conn
    .prepare("PRAGMA table_info(accounts)")
    .all() as unknown as ColumnInfo[];
  if (!cols.some((col) => col.name === "sort_order")) {
    conn.exec("ALTER TABLE accounts ADD COLUMN sort_order INTEGER");
  }
  conn.exec("UPDATE accounts SET sort_order = created_at WHERE sort_order IS NULL");
}

export function listAccounts(): AccountRecord[] {
  return listAccountEntries().flatMap((entry) =>
    entry.ok ? [entry.account] : [],
  );
}

export function listAccountEntries(): AccountEntry[] {
  const rows = db()
    .prepare("SELECT * FROM accounts ORDER BY sort_order, created_at")
    .all() as unknown as StoredAccountRow[];
  const encryptionKey = key();
  return rows.map((row) => accountEntryFromRow(row, encryptionKey, openJSON));
}

export function listAccountSummaries(): AccountSummary[] {
  const rows = db()
    .prepare("SELECT * FROM accounts ORDER BY sort_order, created_at")
    .all() as unknown as StoredAccountRow[];
  return rows.map(accountSummaryFromRow);
}

export function getAccountSummary(id: string): AccountSummary | null {
  const row = db()
    .prepare("SELECT * FROM accounts WHERE id = ?")
    .get(id) as unknown as StoredAccountRow | undefined;
  return row ? accountSummaryFromRow(row) : null;
}

export function createAccount(input: {
  provider: ProviderId;
  label: string;
  secret: AccountSecret;
}): AccountRecord {
  const id = randomUUID();
  const now = Date.now();
  const sealed = sealJSON(input.secret, key());
  db()
    .prepare(
      `INSERT INTO accounts (id, provider, label, secret_blob, iv, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, input.provider, input.label, sealed.blob, sealed.iv, now, now, now);
  return { id, ...input, sortOrder: now, createdAt: now, updatedAt: now };
}

export function updateAccountSecret(id: string, secret: AccountSecret): void {
  const sealed = sealJSON(secret, key());
  db()
    .prepare(
      "UPDATE accounts SET secret_blob = ?, iv = ?, updated_at = ? WHERE id = ?",
    )
    .run(sealed.blob, sealed.iv, Date.now(), id);
}

export function updateAccountLabel(id: string, label: string): void {
  db()
    .prepare("UPDATE accounts SET label = ?, updated_at = ? WHERE id = ?")
    .run(label, Date.now(), id);
}

export function deleteAccount(id: string): void {
  db().prepare("DELETE FROM accounts WHERE id = ?").run(id);
}

export function reorderAccounts(ids: string[]): void {
  const existingIds = listAccountSummaries().map((account) => account.id);
  if (!isCompleteIdOrder(ids, existingIds)) {
    throw new Error("invalid account order");
  }

  const conn = db();
  const now = Date.now();
  conn.exec("BEGIN IMMEDIATE");
  try {
    const stmt = conn.prepare(
      "UPDATE accounts SET sort_order = ?, updated_at = ? WHERE id = ?",
    );
    ids.forEach((id, index) => stmt.run(index + 1, now, id));
    conn.exec("COMMIT");
  } catch (err) {
    conn.exec("ROLLBACK");
    throw err;
  }
}
