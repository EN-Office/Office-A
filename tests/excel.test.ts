import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { exportWorkbook } from "../server/excel";
import { seedDB } from "../server/seed";
import { fiscalMonths } from "@shared/types";

describe("exportWorkbook", () => {
  it("produces the SPEC §5 workbook from seed data", async () => {
    const now = new Date(2026, 9, 1); // 2026-10 → FY2026
    const db = seedDB(now);
    const buf = await exportWorkbook(db, 2026);
    expect(buf.length).toBeGreaterThan(1000);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["メンバー", "案件", "アサイン", "稼働サマリ", "説明"]);

    const months = fiscalMonths(2026, 4);

    const members = wb.getWorksheet("メンバー")!;
    expect(members.rowCount).toBe(1 + db.members.length);
    const rowValues = (ws: ExcelJS.Worksheet, n: number) => {
      const r = ws.getRow(n);
      return Array.from({ length: r.cellCount }, (_, i) => r.getCell(i + 1).value);
    };
    expect(rowValues(members, 1)).toEqual(["ID", "名前", "役職", "上長", "備考"]);
    // 3 行目以降は階層順: 山田 → 佐藤 → 高橋
    expect(rowValues(members, 4).slice(0, 4)).toEqual(["m04", "高橋 健太", "課長代理", "佐藤 花子"]);
    expect(members.getRow(4).getCell(2).alignment?.indent).toBe(2);

    const projects = wb.getWorksheet("案件")!;
    expect(rowValues(projects, 1)).toEqual(["ID", "案件コード", "案件名", "受注金額", "開始", "終了", "必要役割", "色", "備考"]);
    expect(rowValues(projects, 2)).toEqual([
      "p01", "PRJ-2026-001", "基幹業務システム刷新", 48_000_000, "2026-04", "2026-09",
      "PM×1, PL×1, 開発メンバー×3", "#e07a5f", "大手製造業向け。上期で本番切替。",
    ]);

    const asg = wb.getWorksheet("アサイン")!;
    const header = asg.getRow(1);
    const headerValues = Array.from({ length: header.cellCount }, (_, i) => header.getCell(i + 1).value);
    const monthCols = headerValues.filter((v) => typeof v === "string" && /^\d{4}-\d{2}$/.test(v));
    expect(monthCols).toEqual(months);
    // header + members + 月別稼働人月 + 月別稼働時間
    expect(asg.rowCount).toBe(1 + db.members.length + 2);
    expect(headerValues.slice(0, 3)).toEqual(["ID", "メンバー", "階層"]);
    expect(rowValues(asg, 2).slice(0, 3)).toEqual(["m01", "山田 太郎", 0]);
    // 名前はインデント文字を含まない（階層は 階層 列とセル書式で表す）
    expect(rowValues(asg, 3).slice(0, 3)).toEqual(["m02", "佐藤 花子", 1]);
    expect(asg.getRow(asg.rowCount - 1).getCell(2).value).toBe("月別稼働人月");
    expect(asg.getRow(asg.rowCount).getCell(2).value).toBe("月別稼働時間");
    // 売上（受注金額 × 稼働）の集計行は出さない
    for (let r = 1; r <= asg.rowCount; r++) expect(String(asg.getRow(r).getCell(2).value)).not.toContain("売上");

    // 2026-04 の稼働: p01(高橋 0.5 + 伊藤 1) + p04(加藤 1) = 2.5人月 = 400h
    const aprCol = 4;
    expect(asg.getRow(asg.rowCount - 1).getCell(aprCol).value).toBe(2.5);
    expect(asg.getRow(asg.rowCount).getCell(aprCol).value).toBe(400);
    const someCell = asg.getRow(4).getCell(aprCol).value; // 高橋 健太 (3rd in tree)
    expect(someCell).toBe("PRJ-2026-001 [PM] 80h");
    // 1人月も時間で必ず書く
    expect(asg.getRow(5).getCell(aprCol).value).toBe("PRJ-2026-001 [PL] 160h"); // 伊藤 翔

    const help = wb.getWorksheet("説明")!;
    const helpText = Array.from({ length: help.rowCount }, (_, i) => String(help.getRow(i + 1).getCell(2).value ?? "")).join("\n");
    expect(helpText).toContain("案件コード [役割名] 工数h");
    expect(helpText).toContain("1人月 = 160h");
    expect(helpText).toContain("ID");

    const sum = wb.getWorksheet("稼働サマリ")!;
    const sumHead = Array.from({ length: sum.getRow(1).cellCount }, (_, i) => sum.getRow(1).getCell(i + 1).value);
    expect(sumHead.slice(0, 3)).toEqual(["コード", "案件名", "受注金額"]);
    expect(sumHead.slice(3, 15)).toEqual(months);
    expect(sumHead.slice(15)).toEqual(["合計(時間)", "合計(人月)"]);
    // p01 の行: 受注金額はそのまま、4月は 80h + 160h
    expect(sum.getRow(2).getCell(1).value).toBe("PRJ-2026-001");
    expect(sum.getRow(2).getCell(3).value).toBe(48_000_000);
    expect(sum.getRow(2).getCell(4).value).toBe(240);
    const totalMM = db.assignments.reduce((s, a) => s + a.ratio, 0);
    const hoursRow = sum.getRow(sum.rowCount - 1);
    expect(hoursRow.getCell(1).value).toBe("合計(時間)");
    expect(hoursRow.getCell(16).value).toBe(totalMM * 160);
    expect(hoursRow.getCell(3).value).toBe(db.projects.reduce((s, p) => s + p.amount, 0));
    const mmRow = sum.getRow(sum.rowCount);
    expect(mmRow.getCell(1).value).toBe("合計(人月)");
    expect(mmRow.getCell(17).value).toBe(totalMM);
  });
});
