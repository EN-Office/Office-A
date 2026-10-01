/** SPEC §5 の Excel 出力 */
import ExcelJS from "exceljs";
import {
  flattenTree,
  fiscalMonths,
  isWithin,
  type Assignment,
  type DB,
  type MonthKey,
  type Project,
} from "../shared/types";

const JPY = "¥#,##0";
const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEF0F4" } };
const TOTAL_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF7F7F2" } };
const THIN: Partial<ExcelJS.Border> = { style: "thin", color: { argb: "FFBFC4CE" } };
const BORDER: Partial<ExcelJS.Borders> = { top: THIN, left: THIN, bottom: THIN, right: THIN };

export const SHEET_NAMES = ["メンバー", "案件", "アサイン", "売上サマリ"] as const;

function styleHeader(row: ExcelJS.Row): void {
  row.font = { bold: true };
  row.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  row.eachCell((c) => {
    c.fill = HEADER_FILL;
  });
}

function borderAll(ws: ExcelJS.Worksheet): void {
  ws.eachRow((row) => {
    row.eachCell({ includeEmpty: true }, (c) => {
      c.border = BORDER;
    });
  });
}

function styleTotalRow(row: ExcelJS.Row): void {
  row.font = { bold: true };
  row.eachCell({ includeEmpty: true }, (c) => {
    c.fill = TOTAL_FILL;
  });
}

const ratioOf = (a: Assignment): number => (typeof a.ratio === "number" && Number.isFinite(a.ratio) ? a.ratio : 1);
const fmtRatio = (r: number): string => String(Math.round(r * 100) / 100);

export async function exportWorkbook(db: DB, fiscalYear: number): Promise<Buffer> {
  const startMonth = db.settings?.fiscalYearStartMonth ?? 4;
  const months = fiscalMonths(fiscalYear, startMonth);
  const monthSet = new Set<MonthKey>(months);
  const memberById = new Map(db.members.map((m) => [m.id, m]));
  const roleById = new Map(db.roles.map((r) => [r.id, r]));
  const statusById = new Map(db.roleStatuses.map((s) => [s.id, s]));
  const projectById = new Map(db.projects.map((p) => [p.id, p]));
  const tree = flattenTree(db.members);
  const yearAssignments = db.assignments.filter((a) => monthSet.has(a.month) && projectById.has(a.projectId));

  const wb = new ExcelJS.Workbook();
  wb.creator = db.settings?.companyName ?? "Office-A";
  wb.created = new Date();

  /* ---------- メンバー ---------- */
  {
    const ws = wb.addWorksheet(SHEET_NAMES[0], { views: [{ state: "frozen", xSplit: 1, ySplit: 1 }] });
    ws.columns = [
      { header: "名前", key: "name", width: 18 },
      { header: "役職", key: "role", width: 12 },
      { header: "上長", key: "boss", width: 18 },
      { header: "階層パス", key: "path", width: 56 },
      { header: "備考", key: "note", width: 30 },
    ];
    for (const { member } of tree) {
      // 孤児の path は自分のみになるため、上長は parentId から引く
      const pathNames: string[] = [];
      const seen = new Set<string>();
      for (let cur: typeof member | undefined = member; cur && !seen.has(cur.id); cur = cur.parentId ? memberById.get(cur.parentId) : undefined) {
        seen.add(cur.id);
        pathNames.unshift(cur.name);
      }
      ws.addRow({
        name: member.name,
        role: roleById.get(member.roleId)?.name ?? "",
        boss: member.parentId ? (memberById.get(member.parentId)?.name ?? "") : "",
        path: pathNames.join(" > "),
        note: member.note ?? "",
      });
    }
    styleHeader(ws.getRow(1));
    borderAll(ws);
  }

  /* ---------- 案件 ---------- */
  {
    const ws = wb.addWorksheet(SHEET_NAMES[1], { views: [{ state: "frozen", xSplit: 1, ySplit: 1 }] });
    ws.columns = [
      { header: "コード", key: "code", width: 16 },
      { header: "案件名", key: "name", width: 28 },
      { header: "単価(円/人月)", key: "unitPrice", width: 16, style: { numFmt: JPY } },
      { header: "開始", key: "start", width: 10 },
      { header: "終了", key: "end", width: 10 },
      { header: "必要役割", key: "required", width: 36 },
      { header: "備考", key: "note", width: 30 },
    ];
    for (const p of [...db.projects].sort((a, b) => a.code.localeCompare(b.code))) {
      ws.addRow({
        code: p.code,
        name: p.name,
        unitPrice: p.unitPrice,
        start: p.startMonth,
        end: p.endMonth,
        required: (p.required ?? [])
          .map((r) => `${statusById.get(r.statusId)?.name ?? r.statusId}×${r.count}`)
          .join(", "),
        note: p.note ?? "",
      });
    }
    styleHeader(ws.getRow(1));
    borderAll(ws);
  }

  /* ---------- アサイン ---------- */
  {
    const ws = wb.addWorksheet(SHEET_NAMES[2], { views: [{ state: "frozen", xSplit: 1, ySplit: 1 }] });
    ws.columns = [
      { header: "メンバー", key: "member", width: 22 },
      ...months.map((m) => ({ header: m, key: m, width: 30 })),
      { header: "年間稼働(人月)", key: "total", width: 14 },
    ];
    const byMemberMonth = new Map<string, Assignment[]>();
    for (const a of yearAssignments) {
      const k = `${a.memberId}|${a.month}`;
      const list = byMemberMonth.get(k) ?? [];
      list.push(a);
      byMemberMonth.set(k, list);
    }
    for (const { member, depth } of tree) {
      let lines = 1;
      let total = 0;
      const values: Record<string, string | number> = { member: "　".repeat(depth) + member.name };
      for (const m of months) {
        const list = (byMemberMonth.get(`${member.id}|${m}`) ?? []).sort((a, b) =>
          (projectById.get(a.projectId)?.code ?? "").localeCompare(projectById.get(b.projectId)?.code ?? ""),
        );
        lines = Math.max(lines, list.length);
        total += list.reduce((s, a) => s + ratioOf(a), 0);
        values[m] = list
          .map((a) => {
            const p = projectById.get(a.projectId) as Project;
            return `${p.code} ${p.name} ×${fmtRatio(ratioOf(a))}`;
          })
          .join("\n");
      }
      values.total = Math.round(total * 100) / 100;
      const row = ws.addRow(values);
      row.alignment = { vertical: "top", wrapText: true };
      row.height = Math.max(18, lines * 15 + 4);
    }

    const revenueRow: Record<string, string | number> = { member: "月別売上合計" };
    const mmRow: Record<string, string | number> = { member: "月別稼働人月" };
    let revTotal = 0;
    let mmTotal = 0;
    for (const m of months) {
      const list = yearAssignments.filter((a) => a.month === m);
      const rev = list.reduce((s, a) => s + (projectById.get(a.projectId)?.unitPrice ?? 0) * ratioOf(a), 0);
      const mm = list.reduce((s, a) => s + ratioOf(a), 0);
      revenueRow[m] = Math.round(rev);
      mmRow[m] = Math.round(mm * 100) / 100;
      revTotal += rev;
      mmTotal += mm;
    }
    mmRow.total = Math.round(mmTotal * 100) / 100;
    const r1 = ws.addRow(revenueRow);
    r1.numFmt = JPY;
    r1.getCell("total").value = Math.round(revTotal);
    const r2 = ws.addRow(mmRow);
    r2.numFmt = "0.0#";
    for (const r of [r1, r2]) {
      styleTotalRow(r);
      r.alignment = { vertical: "middle", horizontal: "right" };
      r.getCell("member").alignment = { horizontal: "left" };
    }
    ws.getColumn("total").numFmt = "0.0#";
    r1.getCell("total").numFmt = JPY;
    styleHeader(ws.getRow(1));
    borderAll(ws);
  }

  /* ---------- 売上サマリ ---------- */
  {
    const ws = wb.addWorksheet(SHEET_NAMES[3], { views: [{ state: "frozen", xSplit: 2, ySplit: 1 }] });
    ws.columns = [
      { header: "コード", key: "code", width: 16 },
      { header: "案件名", key: "name", width: 28 },
      ...months.map((m) => ({ header: m, key: m, width: 14, style: { numFmt: JPY } })),
      { header: "合計", key: "total", width: 16, style: { numFmt: JPY } },
    ];
    const rev = new Map<string, number>(); // `${projectId}|${month}`
    for (const a of yearAssignments) {
      const p = projectById.get(a.projectId)!;
      const k = `${a.projectId}|${a.month}`;
      rev.set(k, (rev.get(k) ?? 0) + p.unitPrice * ratioOf(a));
    }
    const first = months[0];
    const last = months[months.length - 1];
    const projects = db.projects
      .filter(
        (p) =>
          yearAssignments.some((a) => a.projectId === p.id) ||
          isWithin(p.startMonth, first, last) ||
          isWithin(p.endMonth, first, last) ||
          (p.startMonth <= first && p.endMonth >= last),
      )
      .sort((a, b) => a.code.localeCompare(b.code));
    const colTotals = new Map<MonthKey, number>();
    let grand = 0;
    for (const p of projects) {
      const values: Record<string, string | number> = { code: p.code, name: p.name };
      let total = 0;
      for (const m of months) {
        const v = Math.round(rev.get(`${p.id}|${m}`) ?? 0);
        values[m] = v;
        total += v;
        colTotals.set(m, (colTotals.get(m) ?? 0) + v);
      }
      values.total = total;
      grand += total;
      ws.addRow(values);
    }
    const totalValues: Record<string, string | number> = { code: "合計", name: "", total: grand };
    for (const m of months) totalValues[m] = colTotals.get(m) ?? 0;
    const tr = ws.addRow(totalValues);
    styleTotalRow(tr);
    ws.getColumn("total").font = { bold: true };
    styleHeader(ws.getRow(1));
    borderAll(ws);
  }

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}
