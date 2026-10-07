import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { exportWorkbook } from "../server/excel";
import { ImportError, importWorkbook } from "../server/excelImport";
import { seedDB } from "../server/seed";
import { fiscalMonths, type Assignment, type DB } from "@shared/types";

const NOW = new Date(2026, 9, 1); // FY2026（2026-04 … 2027-03）
const FY = 2026;
const MONTHS = fiscalMonths(FY, 4);

async function exported(db: DB): Promise<Buffer> {
  return exportWorkbook(db, FY);
}

/** 出力したブックを編集して再度 Buffer にする */
async function edit(buf: Buffer, fn: (wb: ExcelJS.Workbook) => void): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  fn(wb);
  return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

/** シート内で列見出しと行（ID または 2 列目の名前）を指定してセルを返す */
function cellAt(ws: ExcelJS.Worksheet, rowKey: string, header: string): ExcelJS.Cell {
  const head = ws.getRow(1);
  let col = 0;
  head.eachCell((c, i) => {
    if (c.value === header) col = i;
  });
  if (!col) throw new Error(`no column ${header}`);
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    if (row.getCell(1).value === rowKey || row.getCell(2).value === rowKey) return row.getCell(col);
  }
  throw new Error(`no row ${rowKey}`);
}

function rowIndexOf(ws: ExcelJS.Worksheet, rowKey: string): number {
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    if (row.getCell(1).value === rowKey || row.getCell(2).value === rowKey) return r;
  }
  throw new Error(`no row ${rowKey}`);
}

const byId = <T extends { id: string }>(xs: T[]) => [...xs].sort((a, b) => a.id.localeCompare(b.id));
const cellOf = (db: DB, memberId: string, month: string) =>
  db.assignments
    .filter((a) => a.memberId === memberId && a.month === month)
    .map((a) => ({ projectId: a.projectId, statusId: a.statusId, ratio: a.ratio }));

describe("importWorkbook", () => {
  it("round-trips the seed data without changes", async () => {
    const db = seedDB(NOW);
    const { db: next, report } = await importWorkbook(await exported(db), db);
    expect(byId(next.members)).toEqual(byId(db.members));
    expect(byId(next.projects)).toEqual(byId(db.projects));
    expect(byId(next.assignments)).toEqual(byId(db.assignments));
    expect(next.roles).toEqual(db.roles);
    expect(next.roleStatuses).toEqual(db.roleStatuses);
    expect(next.settings).toEqual(db.settings);
    expect(next.version).toBe(db.version);
    expect(report.warnings).toEqual([]);
    expect(report.members).toMatchObject({ added: 0, updated: 0, removed: 0 });
    expect(report.projects).toMatchObject({ added: 0, updated: 0, removed: 0 });
    expect(report.assignments.months).toEqual(MONTHS);
    expect(report.assignments.count).toBe(db.assignments.length);
    expect(report.assignments.previous).toBe(db.assignments.length);
  });

  it("keeps assignments outside the sheet's fiscal year", async () => {
    const db = seedDB(NOW);
    const outside: Assignment = { id: "a_next", month: "2027-04", memberId: "m09", projectId: "p04", ratio: 1 };
    db.assignments.push(outside);
    const buf = await edit(await exported(db), (wb) => {
      const ws = wb.getWorksheet("アサイン")!;
      for (const m of MONTHS) cellAt(ws, "m09", m).value = null; // 年度内は全部消す
    });
    const { db: next } = await importWorkbook(buf, db);
    expect(next.assignments.filter((a) => a.memberId === "m09")).toEqual([outside]);
  });

  it("applies typical edits and reports them", async () => {
    const db = seedDB(NOW);
    const buf = await edit(await exported(db), (wb) => {
      const members = wb.getWorksheet("メンバー")!;
      // 1) 改名（上長として参照している行は旧名のまま）
      cellAt(members, "m04", "名前").value = "高橋 健";
      // 2) 既存の上長の下にメンバーを追加
      members.addRow(["", "新人 太郎", "メンバー", "伊藤 翔", "4月入社"]);

      const projects = wb.getWorksheet("案件")!;
      // 3) 案件を追加（未登録の役割 QA を含む）
      projects.addRow(["", "PRJ-2026-099", "新規案件", 500000, "2026-10", "2027-03", "PM×1, QA×2", "", ""]);
      // 5) 案件行を削除
      projects.spliceRows(rowIndexOf(projects, "p06"), 1);

      const asg = wb.getWorksheet("アサイン")!;
      // 4) セルの書き換え
      cellAt(asg, "m04", "2026-05").value = "PRJ-2026-002 [PM] 80h";
      // 新人の行を名前だけで追加し、新規案件にアサイン
      const header = asg.getRow(1);
      const values: Record<number, string> = { 2: "新人 太郎" };
      header.eachCell((c, i) => {
        if (c.value === "2026-10") values[i] = "PRJ-2026-099 [QA]";
      });
      const row = asg.insertRow(rowIndexOf(asg, "月別稼働人月"), []);
      for (const [i, v] of Object.entries(values)) row.getCell(Number(i)).value = v;
    });

    const { db: next, report } = await importWorkbook(buf, db);

    // 改名
    const m04 = next.members.find((m) => m.id === "m04")!;
    expect(m04.name).toBe("高橋 健");
    expect(next.members.find((m) => m.id === "m06")!.parentId).toBe("m04"); // 旧名参照でも上長を維持
    // 追加メンバー
    const rookie = next.members.find((m) => m.name === "新人 太郎")!;
    expect(rookie).toBeTruthy();
    expect(rookie.parentId).toBe("m06");
    expect(rookie.order).toBe(2); // 小林・加藤の後
    expect(rookie.roleId).toBe("role_member");
    expect(rookie.note).toBe("4月入社");
    // 追加案件・新規役割
    const qa = next.roleStatuses.find((s) => s.name === "QA")!;
    expect(qa).toBeTruthy();
    const p99 = next.projects.find((p) => p.code === "PRJ-2026-099")!;
    expect(p99).toMatchObject({ name: "新規案件", amount: 500000, startMonth: "2026-10", endMonth: "2027-03" });
    // 旧形式（人月なし）は 人数 × 案件の月数（2026-10〜2027-03 = 6ヶ月）
    expect(p99.required).toEqual([{ statusId: "st_pm", count: 1, manMonths: 6 }, { statusId: qa.id, count: 2, manMonths: 12 }]);
    expect(cellOf(next, rookie.id, "2026-10")).toEqual([{ projectId: p99.id, statusId: qa.id, ratio: 1 }]);
    // セル書き換え
    expect(cellOf(next, "m04", "2026-05")).toEqual([{ projectId: "p02", statusId: "st_pm", ratio: 0.5 }]);
    expect(cellOf(next, "m04", "2026-04")).toEqual([{ projectId: "p01", statusId: "st_pm", ratio: 0.5 }]);
    // 案件削除とそのアサイン
    expect(next.projects.some((p) => p.id === "p06")).toBe(false);
    expect(next.assignments.some((a) => a.projectId === "p06")).toBe(false);

    expect(report.members).toMatchObject({ added: 1, removed: 0, addedNames: ["新人 太郎"] });
    expect(report.members.updated).toBeGreaterThanOrEqual(1);
    expect(report.projects).toMatchObject({ added: 1, updated: 0, removed: 1 });
    expect(report.projects.removedNames).toEqual(["PRJ-2026-006 モバイル決済アプリ"]);
    expect(report.statusesAdded).toEqual(["QA"]);
    // 削除した案件のコードが残っているセルは警告になる
    expect(report.warnings.length).toBeGreaterThan(0);
    expect(report.warnings.every((w) => /^アサインシート \d+行目 \d{4}-\d{2}: 案件コード「PRJ-2026-006」/.test(w))).toBe(true);

    // 整合性: 孤児 ID がない
    const mIds = new Set(next.members.map((m) => m.id));
    const pIds = new Set(next.projects.map((p) => p.id));
    const sIds = new Set(next.roleStatuses.map((s) => s.id));
    for (const a of next.assignments) {
      expect(mIds.has(a.memberId)).toBe(true);
      expect(pIds.has(a.projectId)).toBe(true);
      if (a.statusId) expect(sIds.has(a.statusId)).toBe(true);
    }
    for (const m of next.members) if (m.parentId) expect(mIds.has(m.parentId)).toBe(true);
  });

  it("deletes members missing from the sheet together with all their assignments", async () => {
    const db = seedDB(NOW);
    db.assignments.push({ id: "a_x", month: "2027-05", memberId: "m14", projectId: "p05", ratio: 1 });
    const buf = await edit(await exported(db), (wb) => {
      const ws = wb.getWorksheet("メンバー")!;
      ws.spliceRows(rowIndexOf(ws, "m14"), 1);
    });
    const { db: next, report } = await importWorkbook(buf, db);
    expect(next.members.some((m) => m.id === "m14")).toBe(false);
    expect(next.assignments.some((a) => a.memberId === "m14")).toBe(false);
    expect(report.members).toMatchObject({ removed: 1, removedNames: ["井上 陽菜"] });
    // アサインシートに残っている行は見つからないメンバーとして警告
    expect(report.warnings.some((w) => w.includes("井上 陽菜"))).toBe(true);
  });

  it("does not delete anything when a sheet has no data rows", async () => {
    const db = seedDB(NOW);
    const buf = await edit(await exported(db), (wb) => {
      const ws = wb.getWorksheet("メンバー")!;
      for (let r = ws.rowCount; r >= 2; r--) ws.spliceRows(r, 1);
    });
    const { db: next, report } = await importWorkbook(buf, db);
    expect(byId(next.members)).toEqual(byId(db.members));
    expect(report.members.removed).toBe(0);
    expect(report.warnings.some((w) => w.includes("データ行がない"))).toBe(true);
  });

  it("round-trips required man-months losslessly at 2 decimals and parses the (N人月) part", async () => {
    const db = seedDB(NOW);
    const p01 = db.projects.find((p) => p.id === "p01")!;
    p01.required = [
      { statusId: "st_pm", count: 1, manMonths: 2.5 },
      { statusId: "st_pl", count: 1, manMonths: 0.01 },
      { statusId: "st_dev", count: 3, manMonths: 12.34 },
    ];
    const buf = await exported(db);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    expect(cellAt(wb.getWorksheet("案件")!, "p01", "必要役割").value).toBe("PM×1 (2.5人月), PL×1 (0.01人月), 開発メンバー×3 (12.34人月)");
    const { db: next, report } = await importWorkbook(buf, db);
    expect(byId(next.projects)).toEqual(byId(db.projects));
    expect(report.projects).toMatchObject({ added: 0, updated: 0, removed: 0 });
    expect(report.warnings).toEqual([]);

    // 手入力の揺れ: 全角括弧・全角数字、人数省略、3 桁目以降は丸め、旧形式との混在、読めない人月は既定値
    const edited = await edit(buf, (w) => {
      cellAt(w.getWorksheet("案件")!, "p01", "必要役割").value =
        "PM×1（１．５人月）, PL (0.333人月), 開発メンバー×2, 開発BP×1 (abc人月)";
    });
    const { db: after, report: r2 } = await importWorkbook(edited, db);
    // p01 は 2026-04〜2026-09 の 6 ヶ月
    expect(after.projects.find((p) => p.id === "p01")!.required).toEqual([
      { statusId: "st_pm", count: 1, manMonths: 1.5 },
      { statusId: "st_pl", count: 1, manMonths: 0.33 },
      { statusId: "st_dev", count: 2, manMonths: 12 },
      { statusId: "st_bp", count: 1, manMonths: 6 },
    ]);
    expect(r2.warnings).toHaveLength(1);
    expect(r2.warnings[0]).toMatch(/必要人月を読めないため、人数 × 案件の月数（6人月）にしました/);
  });

  it("skips malformed lines and clamps hours to 1..2×hoursPerMonth with warnings", async () => {
    const db = seedDB(NOW);
    const buf = await edit(await exported(db), (wb) => {
      const ws = wb.getWorksheet("アサイン")!;
      cellAt(ws, "m10", "2026-04").value = "PRJ-2026-004 400h\nPRJ-2026-001 なにか 変な行\nPRJ-9999-999";
      cellAt(ws, "m09", "2026-04").value = "PRJ-2026-002"; // 役割・工数なしの最小形 = 1人月
      cellAt(ws, "m09", "2026-05").value = "PRJ-2026-002 0.5h";
    });
    const { db: next, report } = await importWorkbook(buf, db);
    expect(cellOf(next, "m10", "2026-04")).toEqual([{ projectId: "p04", statusId: undefined, ratio: 2 }]);
    expect(cellOf(next, "m09", "2026-04")).toEqual([{ projectId: "p02", statusId: undefined, ratio: 1 }]);
    expect(cellOf(next, "m09", "2026-05")).toEqual([{ projectId: "p02", statusId: undefined, ratio: 1 / 160 }]);
    expect(report.warnings).toHaveLength(4);
    const has = (re: RegExp) => expect(report.warnings.some((w) => re.test(w))).toBe(true);
    has(/^アサインシート \d+行目 2026-04: 工数 400h は上限 320h を超えるため 320h にしました$/);
    has(/2026-04: 「PRJ-2026-001 なにか 変な行」を読めないため読み飛ばしました/);
    has(/案件コード「PRJ-9999-999」が見つからない/);
    has(/^アサインシート \d+行目 2026-05: 工数 0\.5h は下限 1h 未満のため 1h にしました$/);
  });

  it("reads hours (h / H / full-width ｈ) and legacy ×ratio lines", async () => {
    const db = seedDB(NOW);
    const buf = await edit(await exported(db), (wb) => {
      const ws = wb.getWorksheet("アサイン")!;
      cellAt(ws, "m09", "2026-04").value = "PRJ-2026-002 [PL] 100h\nPRJ-2026-003 40H\nPRJ-2026-005 １２０ｈ";
      cellAt(ws, "m10", "2026-04").value = "PRJ-2026-004 ×0.5\nPRJ-2026-001 x0.25\nPRJ-2026-002 *1.5";
    });
    const { db: next, report } = await importWorkbook(buf, db);
    const sortByProject = (xs: ReturnType<typeof cellOf>) => [...xs].sort((a, b) => a.projectId.localeCompare(b.projectId));
    expect(sortByProject(cellOf(next, "m09", "2026-04"))).toEqual([
      { projectId: "p02", statusId: "st_pl", ratio: 0.625 },
      { projectId: "p03", statusId: undefined, ratio: 0.25 },
      { projectId: "p05", statusId: undefined, ratio: 0.75 },
    ]);
    expect(sortByProject(cellOf(next, "m10", "2026-04"))).toEqual([
      { projectId: "p01", statusId: undefined, ratio: 0.25 },
      { projectId: "p02", statusId: undefined, ratio: 1.5 },
      { projectId: "p04", statusId: undefined, ratio: 0.5 },
    ]);
    expect(report.warnings).toEqual([]);
  });

  it("round-trips fractional hours losslessly (e.g. 100h = 0.625, 1/3人月)", async () => {
    const db = seedDB(NOW);
    const a04 = db.assignments.find((a) => a.memberId === "m04" && a.month === "2026-04")!;
    a04.ratio = 0.625;
    const a06 = db.assignments.find((a) => a.memberId === "m06" && a.month === "2026-04")!;
    a06.ratio = 1 / 3;
    const buf = await exported(db);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    expect(cellAt(wb.getWorksheet("アサイン")!, "m04", "2026-04").value).toBe("PRJ-2026-001 [PM] 100h");
    expect(cellAt(wb.getWorksheet("アサイン")!, "m06", "2026-04").value).toBe("PRJ-2026-001 [PL] 53.3h");
    const { db: next, report } = await importWorkbook(buf, db);
    expect(byId(next.assignments)).toEqual(byId(db.assignments));
    expect(report.warnings).toEqual([]);
    // 既存アサインがない（新規）場合も 時間 ÷ 160 で復元される
    const fresh = { ...db, assignments: db.assignments.filter((a) => a.id !== a04.id) };
    const { db: next2 } = await importWorkbook(buf, fresh);
    expect(cellOf(next2, "m04", "2026-04")).toEqual([{ projectId: "p01", statusId: "st_pm", ratio: 0.625 }]);
  });

  it("uses settings.hoursPerMonth for export and import", async () => {
    const db = seedDB(NOW);
    db.settings.hoursPerMonth = 140;
    const buf = await exported(db);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    expect(cellAt(wb.getWorksheet("アサイン")!, "m04", "2026-04").value).toBe("PRJ-2026-001 [PM] 70h");
    const { db: next, report } = await importWorkbook(buf, db);
    expect(byId(next.assignments)).toEqual(byId(db.assignments));
    expect(report.warnings).toEqual([]);
  });

  it("reads the legacy 単価 column as 受注金額", async () => {
    const db = seedDB(NOW);
    const buf = await edit(await exported(db), (wb) => {
      const ws = wb.getWorksheet("案件")!;
      ws.getRow(1).eachCell((c) => { if (c.value === "受注金額") c.value = "単価"; });
      cellAt(ws, "p02", "単価").value = 30_000_000;
    });
    const { db: next } = await importWorkbook(buf, db);
    expect(next.projects.find((p) => p.id === "p02")!.amount).toBe(30_000_000);
    expect(next.projects.find((p) => p.id === "p01")!.amount).toBe(48_000_000);
  });

  it("accepts months typed as Excel dates and creates unknown roles", async () => {
    const db = seedDB(NOW);
    const buf = await edit(await exported(db), (wb) => {
      const ws = wb.getWorksheet("案件")!;
      cellAt(ws, "p01", "終了").value = new Date(Date.UTC(2026, 11, 1)); // Excel が日付に変換したケース
      const mem = wb.getWorksheet("メンバー")!;
      cellAt(mem, "m14", "役職").value = "インターン";
    });
    const { db: next, report } = await importWorkbook(buf, db);
    expect(next.projects.find((p) => p.id === "p01")!.endMonth).toBe("2026-12");
    const intern = next.roles.find((r) => r.name === "インターン")!;
    expect(intern.level).toBe(5);
    expect(next.members.find((m) => m.id === "m14")!.roleId).toBe(intern.id);
    expect(report.rolesAdded).toEqual(["インターン"]);
    expect(report.projects.updated).toBe(1);
  });

  it("rejects files that are not xlsx", async () => {
    await expect(importWorkbook(Buffer.from("hello"), seedDB(NOW))).rejects.toBeInstanceOf(ImportError);
  });
});
