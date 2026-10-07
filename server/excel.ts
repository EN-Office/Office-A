/** SPEC §5 の Excel 出力 */
import ExcelJS from "exceljs";
import {
  flattenTree,
  fiscalMonths,
  hoursPerMonthOf,
  isWithin,
  ratioToHours,
  type Assignment,
  type DB,
  type MonthKey,
  roundManMonths,
  type Project,
  type RequiredRole,
} from "../shared/types";

const JPY = "¥#,##0";
const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEF0F4" } };
const TOTAL_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF7F7F2" } };
const THIN: Partial<ExcelJS.Border> = { style: "thin", color: { argb: "FFBFC4CE" } };
const BORDER: Partial<ExcelJS.Borders> = { top: THIN, left: THIN, bottom: THIN, right: THIN };

export const SHEET_NAMES = ["メンバー", "案件", "アサイン", "稼働サマリ", "説明"] as const;
/** アサインシート末尾の集計行（取り込み時は読み飛ばす） */
export const TOTAL_ROW_LABELS = ["月別稼働人月", "月別稼働時間"] as const;
const ID_FONT: Partial<ExcelJS.Font> = { color: { argb: "FF8A8F99" } };

/**
 * アサインセル 1 行分: `<案件コード> [<役割名>] <時間>h`（役割なしは省略。時間は常に書く）。
 * 時間 = ratio × 1人月時間（小数 1 桁）。取り込み側は 時間 ÷ 1人月時間 で ratio に戻す
 */
export function formatAssignmentLine(project: Pick<Project, "code">, statusName: string | undefined, ratio: number, hoursPerMonth: number): string {
  let s = project.code;
  if (statusName) s += ` [${statusName}]`;
  s += ` ${ratioToHours(ratio, hoursPerMonth)}h`;
  return s;
}

/**
 * 必要役割 1 件分: `<役割名>×<人数> (<必要人月>人月)`（人月は小数 2 桁まで、末尾の 0 は省略）。
 * 取り込み側は `(N人月)` を省略した旧形式も受け付ける
 */
export function formatRequiredRole(statusName: string, r: Pick<RequiredRole, "count" | "manMonths">): string {
  return `${statusName}×${r.count} (${roundManMonths(r.manMonths)}人月)`;
}

function helpRows(hpm: number): Array<[string, string]> {
  return [
    ["Office-A Excel 取り込みルール", ""],
    ["", ""],
    ["全般", "このファイルを Excel で編集し、設定画面の「Excelから取り込み」で読み込むとデータに反映されます。取り込み前にプレビュー（追加・更新・削除の件数と警告）が表示されます。"],
    ["", "各シートの 1 行目（見出し）は変更しないでください。列の並び替えは可能ですが、見出し名で列を判別します。"],
    ["", "ID 列は既存データとの対応付けに使います。値は変更しないでください。新しく追加する行は ID を空欄にします。"],
    ["", "行の追加・削除ができます。シートから消した行（メンバー / 案件）は取り込み時に削除され、その人・案件のアサインもすべて削除されます。"],
    ["", "「稼働サマリ」シートは参照用です。取り込み時には読み込みません。"],
    ["", `工数は時間で表します。1人月 = ${hpm}h（設定画面の「1人月の時間」で変更できます）。`],
    ["", ""],
    ["メンバー", "編集可能: 名前 / 役職 / 上長 / 備考。"],
    ["", "役職は役職名で指定します。未登録の役職名は新しい役職（最下位）として追加されます。"],
    ["", "上長は上長の名前で指定します（空欄はトップ）。見つからない名前は警告を出してトップ扱いになります。"],
    ["", "ID が空欄の行は、同じ名前の既存メンバーがいればそのメンバー、いなければ新規メンバーとして扱います。"],
    ["", "同じ上長を持つメンバーの並び順は、シートの行順になります。"],
    ["", ""],
    ["案件", "編集可能: 案件コード / 案件名 / 受注金額 / 開始 / 終了 / 必要役割 / 色 / 備考。"],
    ["", "開始・終了は YYYY-MM 形式（例: 2026-04）。受注金額は案件全体の契約額（円、数値）で、入力値をそのまま保持します（稼働とは掛け合わせません）。"],
    ["", "必要役割は「PM×1 (2.5人月), PL×1 (1人月), 開発メンバー×3 (12人月)」の形式（役割名×人数 (必要人月)）。必要人月は案件期間全体で必要な工数の合計で、0.01 以上・小数 2 桁まで。"],
    ["", "「(N人月)」を省略した場合（旧形式「PM×1」など）は 人数 × 案件の月数 を必要人月とします。未登録の役割名は新しい役割として追加されます。"],
    ["", "色は #RRGGBB 形式（例: #e07a5f）。空欄の場合は自動で割り当てます。"],
    ["", ""],
    ["アサイン", "この年度の 12 ヶ月分のアサインを、シートの内容で置き換えます（ほかの年度のアサインは変更されません）。"],
    ["", "1 セルに 1 件 1 行で書きます（セル内改行は Alt+Enter）。書式: 案件コード [役割名] 工数h"],
    ["", `例: PRJ-2026-001 [PL] 80h ／ PRJ-2026-002 [PM] ${hpm}h ／ PRJ-2026-003（役割なし・工数省略 = ${hpm}h = 1人月）`],
    ["", `工数は時間（h）で 1〜${hpm * 2}h（${hpm}h = 1人月、残業込みで 2人月分まで）。範囲外の値は丸められます（警告あり）。小数は 0.1h 単位。`],
    ["", "旧形式の按分（例: PRJ-2026-001 ×0.5）も読み込めます（0.5人月として扱います）。"],
    ["", "未登録の案件コードを書いた行は読み飛ばします（警告あり）。"],
    ["", "メンバーは ID 列（空欄なら名前）で判別します。階層列・年間稼働列・末尾の集計行は参照用で、読み込みません。"],
  ];
}

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
  const hpm = hoursPerMonthOf(db);

  const wb = new ExcelJS.Workbook();
  wb.creator = db.settings?.companyName ?? "Office-A";
  wb.created = new Date();

  /* ---------- メンバー ---------- */
  {
    const ws = wb.addWorksheet(SHEET_NAMES[0], { views: [{ state: "frozen", xSplit: 2, ySplit: 1 }] });
    ws.columns = [
      { header: "ID", key: "id", width: 12 },
      { header: "名前", key: "name", width: 18 },
      { header: "役職", key: "role", width: 12 },
      { header: "上長", key: "boss", width: 18 },
      { header: "備考", key: "note", width: 36 },
    ];
    for (const { member, depth } of tree) {
      const row = ws.addRow({
        id: member.id,
        name: member.name,
        role: roleById.get(member.roleId)?.name ?? "",
        boss: member.parentId ? (memberById.get(member.parentId)?.name ?? "") : "",
        note: member.note ?? "",
      });
      // 階層は書式（インデント）で表す。セルの値は素の名前のまま
      row.getCell("name").alignment = { indent: Math.min(depth, 15) };
    }
    ws.getColumn("id").font = ID_FONT;
    styleHeader(ws.getRow(1));
    borderAll(ws);
  }

  /* ---------- 案件 ---------- */
  {
    const ws = wb.addWorksheet(SHEET_NAMES[1], { views: [{ state: "frozen", xSplit: 2, ySplit: 1 }] });
    ws.columns = [
      { header: "ID", key: "id", width: 12 },
      { header: "案件コード", key: "code", width: 16 },
      { header: "案件名", key: "name", width: 28 },
      { header: "受注金額", key: "amount", width: 16, style: { numFmt: JPY } },
      { header: "開始", key: "start", width: 10, style: { numFmt: "@" } },
      { header: "終了", key: "end", width: 10, style: { numFmt: "@" } },
      { header: "必要役割", key: "required", width: 48 },
      { header: "色", key: "color", width: 10 },
      { header: "備考", key: "note", width: 30 },
    ];
    for (const p of [...db.projects].sort((a, b) => a.code.localeCompare(b.code))) {
      ws.addRow({
        id: p.id,
        code: p.code,
        name: p.name,
        amount: p.amount,
        start: p.startMonth,
        end: p.endMonth,
        required: (p.required ?? [])
          .map((r) => formatRequiredRole(statusById.get(r.statusId)?.name ?? r.statusId, r))
          .join(", "),
        color: p.color,
        note: p.note ?? "",
      });
    }
    ws.getColumn("id").font = ID_FONT;
    styleHeader(ws.getRow(1));
    borderAll(ws);
  }

  /* ---------- アサイン ---------- */
  {
    const ws = wb.addWorksheet(SHEET_NAMES[2], { views: [{ state: "frozen", xSplit: 3, ySplit: 1 }] });
    ws.columns = [
      { header: "ID", key: "id", width: 12 },
      { header: "メンバー", key: "member", width: 22 },
      { header: "階層", key: "depth", width: 6 },
      ...months.map((m) => ({ header: m, key: m, width: 26 })),
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
      const values: Record<string, string | number> = { id: member.id, member: member.name, depth };
      for (const m of months) {
        const list = (byMemberMonth.get(`${member.id}|${m}`) ?? []).sort((a, b) =>
          (projectById.get(a.projectId)?.code ?? "").localeCompare(projectById.get(b.projectId)?.code ?? ""),
        );
        lines = Math.max(lines, list.length);
        total += list.reduce((s, a) => s + ratioOf(a), 0);
        values[m] = list
          .map((a) => formatAssignmentLine(projectById.get(a.projectId) as Project, a.statusId ? statusById.get(a.statusId)?.name : undefined, ratioOf(a), hpm))
          .join("\n");
      }
      values.total = Math.round(total * 100) / 100;
      const row = ws.addRow(values);
      row.alignment = { vertical: "top", wrapText: true };
      row.getCell("member").alignment = { vertical: "top", indent: Math.min(depth, 15) };
      row.getCell("depth").alignment = { vertical: "top", horizontal: "center" };
      row.height = Math.max(18, lines * 15 + 4);
    }

    const mmRow: Record<string, string | number> = { member: TOTAL_ROW_LABELS[0] };
    const hRow: Record<string, string | number> = { member: TOTAL_ROW_LABELS[1] };
    let mmTotal = 0;
    for (const m of months) {
      const mm = yearAssignments.filter((a) => a.month === m).reduce((s, a) => s + ratioOf(a), 0);
      mmRow[m] = Math.round(mm * 100) / 100;
      hRow[m] = ratioToHours(mm, hpm);
      mmTotal += mm;
    }
    mmRow.total = Math.round(mmTotal * 100) / 100;
    hRow.total = ratioToHours(mmTotal, hpm);
    const r1 = ws.addRow(mmRow);
    r1.numFmt = "0.0#";
    const r2 = ws.addRow(hRow);
    r2.numFmt = '#,##0.#"h"';
    for (const r of [r1, r2]) {
      styleTotalRow(r);
      r.alignment = { vertical: "middle", horizontal: "right" };
      r.getCell("member").alignment = { horizontal: "left" };
    }
    ws.getColumn("total").numFmt = "0.0#";
    r2.getCell("total").numFmt = '#,##0.#"h"';
    ws.getColumn("id").font = ID_FONT;
    styleHeader(ws.getRow(1));
    borderAll(ws);
  }

  /* ---------- 稼働サマリ（参照用: 案件 × 月の稼働時間） ---------- */
  {
    const HOURS = '#,##0.#"h"';
    const ws = wb.addWorksheet(SHEET_NAMES[3], { views: [{ state: "frozen", xSplit: 3, ySplit: 1 }] });
    ws.columns = [
      { header: "コード", key: "code", width: 16 },
      { header: "案件名", key: "name", width: 28 },
      { header: "受注金額", key: "amount", width: 16, style: { numFmt: JPY } },
      ...months.map((m) => ({ header: m, key: m, width: 11, style: { numFmt: HOURS } })),
      { header: "合計(時間)", key: "total", width: 12, style: { numFmt: HOURS } },
      { header: "合計(人月)", key: "mm", width: 11, style: { numFmt: "0.0#" } },
    ];
    const ratioSum = new Map<string, number>(); // `${projectId}|${month}` → Σratio
    for (const a of yearAssignments) {
      const k = `${a.projectId}|${a.month}`;
      ratioSum.set(k, (ratioSum.get(k) ?? 0) + ratioOf(a));
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
    const colMM = new Map<MonthKey, number>();
    let grandMM = 0;
    let amountTotal = 0;
    for (const p of projects) {
      const values: Record<string, string | number> = { code: p.code, name: p.name, amount: p.amount };
      let mm = 0;
      for (const m of months) {
        const v = ratioSum.get(`${p.id}|${m}`) ?? 0;
        values[m] = ratioToHours(v, hpm);
        mm += v;
        colMM.set(m, (colMM.get(m) ?? 0) + v);
      }
      values.total = ratioToHours(mm, hpm);
      values.mm = Math.round(mm * 100) / 100;
      grandMM += mm;
      amountTotal += p.amount;
      ws.addRow(values);
    }
    const hoursTotal: Record<string, string | number> = {
      code: "合計(時間)", name: "", amount: amountTotal, total: ratioToHours(grandMM, hpm), mm: Math.round(grandMM * 100) / 100,
    };
    const mmTotal: Record<string, string | number> = { code: "合計(人月)", name: "", mm: Math.round(grandMM * 100) / 100 };
    for (const m of months) {
      hoursTotal[m] = ratioToHours(colMM.get(m) ?? 0, hpm);
      mmTotal[m] = Math.round((colMM.get(m) ?? 0) * 100) / 100;
    }
    const tr = ws.addRow(hoursTotal);
    const tm = ws.addRow(mmTotal);
    for (const m of months) tm.getCell(m).numFmt = "0.0#";
    styleTotalRow(tr);
    styleTotalRow(tm);
    ws.getColumn("total").font = { bold: true };
    styleHeader(ws.getRow(1));
    borderAll(ws);
  }

  /* ---------- 説明 ---------- */
  {
    const ws = wb.addWorksheet(SHEET_NAMES[4]);
    ws.columns = [
      { key: "topic", width: 14 },
      { key: "text", width: 110 },
    ];
    for (const [topic, text] of helpRows(hpm)) {
      const row = ws.addRow({ topic, text });
      row.alignment = { vertical: "top", wrapText: true };
      if (topic) row.getCell("topic").font = { bold: true };
    }
    ws.getRow(1).font = { bold: true, size: 14 };
  }

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}
