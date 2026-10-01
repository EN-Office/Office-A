import type { DB, ImportReport } from "@shared/types";

export async function fetchDB(): Promise<DB> {
  const r = await fetch("/api/db");
  if (!r.ok) throw new Error(`GET /api/db ${r.status}`);
  return r.json();
}

/** 楽観ロック: サーバは body.version が現在と一致する場合のみ受理し、version+1 を返す */
export async function saveDB(db: DB): Promise<{ version: number }> {
  const r = await fetch("/api/db", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(db),
  });
  if (r.status === 409) throw new Error("conflict");
  if (!r.ok) throw new Error(`PUT /api/db ${r.status}`);
  return r.json();
}

export function exportUrl(fiscalYear: number): string {
  return `/api/export.xlsx?year=${fiscalYear}`;
}

/**
 * 編集した Excel を取り込む。dryRun=true の場合はサーバ側で保存せず、レポートのみ返す。
 * 失敗時はサーバのエラーメッセージを持つ Error を投げる。
 */
export async function importXlsx(file: Blob, dryRun: boolean): Promise<{ version?: number; report: ImportReport }> {
  const r = await fetch(`/api/import.xlsx${dryRun ? "?dryRun=1" : ""}`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: file,
  });
  const body = (await r.json().catch(() => null)) as { error?: string; version?: number; report?: ImportReport } | null;
  if (!r.ok || !body?.report) {
    if (r.status === 409) throw new Error("取り込み中にデータが更新されました。もう一度お試しください");
    throw new Error(body?.error ?? `POST /api/import.xlsx ${r.status}`);
  }
  return { version: body.version, report: body.report };
}
