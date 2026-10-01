import type { DB } from "@shared/types";

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
