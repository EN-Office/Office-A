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
    expect(wb.worksheets.map((w) => w.name)).toEqual(["メンバー", "案件", "アサイン", "売上サマリ"]);

    const months = fiscalMonths(2026, 4);

    const members = wb.getWorksheet("メンバー")!;
    expect(members.rowCount).toBe(1 + db.members.length);
    expect(members.getRow(4).getCell(4).value).toBe("山田 太郎 > 佐藤 花子 > 高橋 健太");

    const projects = wb.getWorksheet("案件")!;
    expect(projects.getRow(2).getCell(1).value).toBe("PRJ-2026-001");
    expect(projects.getRow(2).getCell(6).value).toBe("PM×1, PL×1, 開発メンバー×3");

    const asg = wb.getWorksheet("アサイン")!;
    const header = asg.getRow(1);
    const headerValues = Array.from({ length: header.cellCount }, (_, i) => header.getCell(i + 1).value);
    const monthCols = headerValues.filter((v) => typeof v === "string" && /^\d{4}-\d{2}$/.test(v));
    expect(monthCols).toEqual(months);
    // header + members + 月別売上合計 + 月別稼働人月
    expect(asg.rowCount).toBe(1 + db.members.length + 2);
    expect(asg.getRow(2).getCell(1).value).toBe("山田 太郎");
    expect(asg.getRow(3).getCell(1).value).toBe("　佐藤 花子");
    expect(asg.getRow(asg.rowCount - 1).getCell(1).value).toBe("月別売上合計");
    expect(asg.getRow(asg.rowCount).getCell(1).value).toBe("月別稼働人月");

    // 2026-04 の売上: p01(高橋 0.5 + 伊藤 1) * 1.2M + p04(加藤 1) * 650k
    const aprCol = 2;
    expect(asg.getRow(asg.rowCount - 1).getCell(aprCol).value).toBe(1_200_000 * 1.5 + 650_000);
    const someCell = asg.getRow(4).getCell(aprCol).value; // 高橋 健太 (3rd in tree)
    expect(someCell).toBe("PRJ-2026-001 基幹業務システム刷新 ×0.5");

    const rev = wb.getWorksheet("売上サマリ")!;
    const last = rev.getRow(rev.rowCount);
    expect(last.getCell(1).value).toBe("合計");
    const expectedGrand = db.assignments.reduce(
      (s, a) => s + db.projects.find((p) => p.id === a.projectId)!.unitPrice * a.ratio,
      0,
    );
    expect(last.getCell(2 + 12 + 1).value).toBe(expectedGrand);
  });
});
