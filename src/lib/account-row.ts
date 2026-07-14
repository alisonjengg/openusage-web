import type {
  AccountRecord,
  AccountSecret,
  AccountSummary,
  ProviderId,
} from "./providers/types";

export type StoredAccountRow = {
  id: string;
  provider: string;
  label: string;
  secret_blob: Uint8Array;
  iv: Uint8Array;
  sort_order: number;
  created_at: number;
  updated_at: number;
};

export type AccountEntry =
  | { ok: true; account: AccountRecord }
  | { ok: false; summary: AccountSummary; error: string };

export type SecretOpener = <T>(
  sealed: { blob: Buffer; iv: Buffer },
  key: Buffer,
) => T;

export function accountSummaryFromRow(row: StoredAccountRow): AccountSummary {
  return {
    id: row.id,
    provider: row.provider as ProviderId,
    label: row.label,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function accountRecordFromRow(
  row: StoredAccountRow,
  key: Buffer,
  openSecret: SecretOpener,
): AccountRecord {
  return {
    ...accountSummaryFromRow(row),
    secret: openSecret<AccountSecret>(
      { blob: Buffer.from(row.secret_blob), iv: Buffer.from(row.iv) },
      key,
    ),
  };
}

export function accountEntryFromRow(
  row: StoredAccountRow,
  key: Buffer,
  openSecret: SecretOpener,
): AccountEntry {
  try {
    return { ok: true, account: accountRecordFromRow(row, key, openSecret) };
  } catch {
    return {
      ok: false,
      summary: accountSummaryFromRow(row),
      error: "Stored credentials could not be decrypted.",
    };
  }
}
