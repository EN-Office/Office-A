/**
 * Excel 取り込み（exportWorkbook で出力したブックを編集して読み戻す）。
 * 純粋関数: 現在の DB とブックから「次の DB」と取り込みレポートを作る。保存・version 管理は呼び出し側。
 */
import ExcelJS from "exceljs";
import {
  defaultManMonths,
  hoursPerMonthOf,
  hoursRange,
  ratioToHours,
  roundManMonths,
  uid,
  type Assignment,
  type DB,
  type ID,
  type ImportEntityReport,
  type ImportReport,
  type Member,
  type MonthKey,
  type Project,
  type RequiredRole,
  type Role,
  type RoleStatus,
} from "../shared/types";
import { SHEET_NAMES, TOTAL_ROW_LABELS } from "./excel";

/** 取り込みを続行できない入力（xlsx でない等） */
export class ImportError extends Error {}

const [SHEET_MEMBERS, SHEET_PROJECTS, SHEET_ASSIGN] = SHEET_NAMES;

const PALETTE = [
  "#e4572e", "#f3a712", "#d9a300", "#76b041", "#2e8b57", "#17bebb",
  "#2f6fab", "#3b4a6b", "#7b5ea7", "#c2477f", "#8a6a4f", "#1d1d1f",
];

/**
 * アサインセル 1 行の書式（NFKC 正規化後に照合。全角の「８０ｈ」も可）:
 *   `<案件コード> [<役割名>] <時間>h`   … 時間 ÷ 1人月時間 = ratio
 *   `<案件コード> [<役割名>] ×<ratio>`  … 旧形式（x / X / * も可）
 *   `<案件コード> [<役割名>]`           … 1人月
 * グループ: 1=コード, 2=役割名, 3=旧形式の按分, 4=時間
 */
export const ASSIGNMENT_LINE_RE = /^([^\s[\]×]+)(?:\s*\[(.*?)\])?(?:\s*(?:[×xX*]\s*([0-9.]+)|([0-9.]+)\s*[hH]))?$/;
/** 旧版で出力した集計行（取り込み時は読み飛ばす） */
const LEGACY_TOTAL_ROW_LABELS = ["月別売上合計"];

/* ---------- セル値ヘルパ ---------- */

/** 比較用キー（全角半角・前後空白の揺れを吸収） */
const key = (s: string): string => s.normalize("NFKC").trim();

function cellText(v: ExcelJS.CellValue | undefined): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    if ("richText" in v && Array.isArray(v.richText)) return v.richText.map((t) => t.text).join("").trim();
    if ("result" in v) return cellText(v.result as ExcelJS.CellValue);
    if ("text" in v && typeof v.text === "string") return v.text.trim();
    if ("error" in v) return "";
  }
  return String(v).trim();
}

function dateToMonth(d: Date): MonthKey {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** "YYYY-MM" / "YYYY/M" / "YYYY年M月" / Date / Excel シリアル値 → MonthKey */
function parseMonthCell(v: ExcelJS.CellValue | undefined): MonthKey | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : dateToMonth(v);
  if (typeof v === "object" && v !== null && "result" in v) return parseMonthCell(v.result as ExcelJS.CellValue);
  if (typeof v === "number" && v > 20000 && v < 80000) {
    return dateToMonth(new Date(Math.round((v - 25569) * 86400000)));
  }
  const s = key(cellText(v));
  const m = /^(\d{4})\s*[-/.年]\s*(\d{1,2})(?:\s*月)?(?:[-/.]\d{1,2}.*)?$/.exec(s) ?? /^(\d{4})-(\d{2})-\d{2}T/.exec(s);
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return `${m[1]}-${String(month).padStart(2, "0")}`;
}

function parseNumberCell(v: ExcelJS.CellValue | undefined): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "object" && v !== null && "result" in v) return parseNumberCell(v.result as ExcelJS.CellValue);
  const s = key(cellText(v)).replace(/[¥￥,円\s]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/* ---------- シート読込 ---------- */

interface SheetRow {
  rowNo: number;
  get: (col: string) => ExcelJS.CellValue | undefined;
  text: (col: string) => string;
}

interface Sheet {
  name: string;
  /** 正規化した見出し → 列番号 */
  cols: Map<string, number>;
  headerCells: Array<{ col: number; value: ExcelJS.CellValue }>;
  rows: SheetRow[];
}

/** 見出しの正規化: 括弧書き（"受注金額(円)" → "受注金額"）を落とす */
const headerKey = (s: string): string => key(s).replace(/\s*\(.*\)\s*$/, "");

function readSheet(ws: ExcelJS.Worksheet, aliases: Record<string, string[]>): Sheet {
  const cols = new Map<string, number>();
  const headerCells: Sheet["headerCells"] = [];
  ws.getRow(1).eachCell({ includeEmpty: false }, (cell, col) => {
    headerCells.push({ col, value: cell.value });
    const h = headerKey(cellText(cell.value));
    for (const [canon, names] of Object.entries(aliases)) {
      if (!cols.has(canon) && names.includes(h)) cols.set(canon, col);
    }
  });
  const rows: SheetRow[] = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNo) => {
    if (rowNo === 1) return;
    const get = (c: string) => {
      const idx = cols.get(c);
      return idx === undefined ? undefined : row.getCell(idx).value;
    };
    rows.push({ rowNo, get, text: (c) => cellText(get(c)) });
  });
  return { name: ws.name, cols, headerCells, rows };
}

/* ---------- 本体 ---------- */

export async function importWorkbook(
  buffer: Buffer | ArrayBuffer | Uint8Array,
  current: DB,
): Promise<{ db: DB; report: ImportReport }> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new ImportError("Excel ファイル（.xlsx）として読み込めませんでした");
  }
  const wsMembers = wb.getWorksheet(SHEET_MEMBERS);
  const wsProjects = wb.getWorksheet(SHEET_PROJECTS);
  const wsAssign = wb.getWorksheet(SHEET_ASSIGN);
  if (!wsMembers && !wsProjects && !wsAssign) {
    throw new ImportError(`「${SHEET_MEMBERS}」「${SHEET_PROJECTS}」「${SHEET_ASSIGN}」のいずれのシートも見つかりません。Office-A から出力したファイルを使ってください`);
  }

  const warnings: string[] = [];
  const at = (sheet: string, rowNo: number, extra = "") => `${sheet}シート ${rowNo}行目${extra}: `;
  const emptyEntity = (): ImportEntityReport => ({ added: 0, updated: 0, removed: 0, addedNames: [], removedNames: [] });
  const report: ImportReport = {
    members: emptyEntity(),
    projects: emptyEntity(),
    assignments: { count: 0, previous: 0, months: [] },
    rolesAdded: [],
    statusesAdded: [],
    warnings,
  };

  const roles: Role[] = current.roles.map((r) => ({ ...r }));
  const statuses: RoleStatus[] = current.roleStatuses.map((s) => ({ ...s }));
  let members: Member[] = current.members.map((m) => ({ ...m }));
  let projects: Project[] = current.projects.map((p) => ({ ...p, required: p.required.map((r) => ({ ...r })) }));

  const findStatus = (name: string): RoleStatus => {
    const found = statuses.find((s) => key(s.name) === key(name));
    if (found) return found;
    const s: RoleStatus = {
      id: uid("st_"),
      name: name.trim(),
      color: PALETTE[statuses.length % PALETTE.length],
      order: statuses.reduce((mx, x) => Math.max(mx, x.order + 1), 0),
    };
    statuses.push(s);
    report.statusesAdded.push(s.name);
    return s;
  };

  /* ===== メンバー ===== */
  if (!wsMembers) {
    warnings.push(`「${SHEET_MEMBERS}」シートがないため、メンバーは変更しません`);
  } else {
    const sh = readSheet(wsMembers, { id: ["ID"], name: ["名前", "メンバー"], role: ["役職"], boss: ["上長"], note: ["備考"] });
    if (!sh.cols.has("name")) {
      warnings.push(`「${SHEET_MEMBERS}」シートに「名前」列がないため、メンバーは変更しません`);
    } else {
      type Entry = { rowNo: number; id: string; name: string; role: string; boss: string; note: string; existing?: Member };
      const entries: Entry[] = [];
      for (const r of sh.rows) {
        const e: Entry = { rowNo: r.rowNo, id: r.text("id"), name: r.text("name"), role: r.text("role"), boss: r.text("boss"), note: r.text("note") };
        if (!e.id && !e.name && !e.role && !e.boss && !e.note) continue;
        if (!e.name) {
          warnings.push(at(sh.name, r.rowNo) + "名前が空のため読み飛ばしました");
          continue;
        }
        entries.push(e);
      }
      if (entries.length === 0) {
        warnings.push(`「${SHEET_MEMBERS}」シートにデータ行がないため、メンバーは変更しません`);
      } else {
        const byId = new Map(current.members.map((m) => [m.id, m]));
        const claimed = new Set<ID>();
        // 1) ID で対応付け
        for (const e of entries) {
          if (!e.id) continue;
          const m = byId.get(e.id);
          if (!m) {
            warnings.push(at(sh.name, e.rowNo) + `ID「${e.id}」は存在しないため、名前で照合します`);
          } else if (claimed.has(m.id)) {
            warnings.push(at(sh.name, e.rowNo) + `ID「${e.id}」が重複しています。名前で照合します`);
          } else {
            e.existing = m;
            claimed.add(m.id);
          }
        }
        // 2) 名前で対応付け
        for (const e of entries) {
          if (e.existing) continue;
          const m = current.members.find((x) => !claimed.has(x.id) && key(x.name) === key(e.name));
          if (m) {
            e.existing = m;
            claimed.add(m.id);
          }
        }
        // 役職
        const lowestRole = () => [...roles].sort((a, b) => b.level - a.level)[0];
        const findRole = (name: string): Role => {
          const found = roles.find((r) => key(r.name) === key(name));
          if (found) return found;
          const r: Role = {
            id: uid("role_"),
            name: name.trim(),
            level: roles.reduce((mx, x) => Math.max(mx, x.level), -1) + 1,
            color: PALETTE[roles.length % PALETTE.length],
          };
          roles.push(r);
          report.rolesAdded.push(r.name);
          return r;
        };
        const next: Member[] = [];
        const rowOf = new Map<ID, number>();
        const bossOf = new Map<ID, string>();
        for (const e of entries) {
          let roleId: ID;
          if (e.role) roleId = findRole(e.role).id;
          else if (e.existing) roleId = e.existing.roleId;
          else {
            const r = lowestRole();
            if (!r) {
              warnings.push(at(sh.name, e.rowNo) + "役職が未設定で、登録済みの役職もないため読み飛ばしました");
              continue;
            }
            roleId = r.id;
            warnings.push(at(sh.name, e.rowNo) + `役職が空のため「${r.name}」にしました`);
          }
          const m: Member = {
            id: e.existing?.id ?? uid("m_"),
            name: e.name,
            roleId,
            parentId: null,
            order: 0,
            ...(e.note ? { note: e.note } : {}),
          };
          next.push(m);
          rowOf.set(m.id, e.rowNo);
          bossOf.set(m.id, e.boss);
        }
        // 上長（全員が揃ってから名前で解決）
        for (const m of next) {
          const boss = bossOf.get(m.id) ?? "";
          if (!boss) continue;
          const rowNo = rowOf.get(m.id)!;
          let cands = next.filter((x) => x.id !== m.id && key(x.name) === key(boss));
          if (cands.length === 0) {
            // 上長側を同じファイル内で改名した場合: 旧名で照合する
            const nextIds = new Set(next.map((x) => x.id));
            const old = current.members.filter((x) => x.id !== m.id && nextIds.has(x.id) && key(x.name) === key(boss));
            cands = next.filter((x) => old.some((o) => o.id === x.id));
          }
          if (cands.length === 0) {
            const self = key(m.name) === key(boss);
            warnings.push(at(sh.name, rowNo) + (self ? "上長に自分自身は指定できません。トップとして扱います" : `上長「${boss}」が見つからないため、トップとして扱います`));
            continue;
          }
          if (cands.length > 1) {
            const prev = current.members.find((x) => x.id === m.id)?.parentId;
            const pick = cands.find((c) => c.id === prev) ?? cands[0];
            warnings.push(at(sh.name, rowNo) + `上長「${boss}」が複数いるため、${rowOf.get(pick.id)}行目の人を上長にしました`);
            m.parentId = pick.id;
          } else {
            m.parentId = cands[0].id;
          }
        }
        // 循環の解消
        const nextById = new Map(next.map((m) => [m.id, m]));
        for (const m of next) {
          const seen = new Set<ID>([m.id]);
          let p = m.parentId;
          while (p) {
            if (seen.has(p)) {
              warnings.push(at(sh.name, rowOf.get(m.id)!) + "上長の指定が循環しているため、トップとして扱います");
              m.parentId = null;
              break;
            }
            seen.add(p);
            p = nextById.get(p)?.parentId ?? null;
          }
        }
        // 兄弟内の並び順 = シートの行順
        const counter = new Map<ID | null, number>();
        for (const m of next) {
          const n = counter.get(m.parentId) ?? 0;
          m.order = n;
          counter.set(m.parentId, n + 1);
        }
        // レポート
        const prevById = new Map(current.members.map((m) => [m.id, m]));
        for (const m of next) {
          const prev = prevById.get(m.id);
          if (!prev) {
            report.members.added++;
            report.members.addedNames.push(m.name);
          } else if (
            prev.name !== m.name || prev.roleId !== m.roleId || prev.parentId !== m.parentId ||
            prev.order !== m.order || (prev.note ?? "") !== (m.note ?? "")
          ) {
            report.members.updated++;
          }
        }
        for (const m of current.members) {
          if (!nextById.has(m.id)) {
            report.members.removed++;
            report.members.removedNames.push(m.name);
          }
        }
        members = next;
      }
    }
  }

  /* ===== 案件 ===== */
  if (!wsProjects) {
    warnings.push(`「${SHEET_PROJECTS}」シートがないため、案件は変更しません`);
  } else {
    const sh = readSheet(wsProjects, {
      // 旧版の「単価」列も受注金額として読む（値はそのまま）
      id: ["ID"], code: ["案件コード", "コード"], name: ["案件名"], amount: ["受注金額", "単価"], start: ["開始"], end: ["終了"],
      required: ["必要役割"], color: ["色"], note: ["備考"],
    });
    if (!sh.cols.has("code")) {
      warnings.push(`「${SHEET_PROJECTS}」シートに「案件コード」列がないため、案件は変更しません`);
    } else {
      type Entry = { r: SheetRow; id: string; code: string; existing?: Project };
      const entries: Entry[] = [];
      for (const r of sh.rows) {
        const id = r.text("id");
        const code = r.text("code");
        const blank = ["name", "amount", "start", "end", "required", "color", "note"].every((c) => !r.text(c));
        if (!id && !code && blank) continue;
        if (!code) {
          warnings.push(at(sh.name, r.rowNo) + "案件コードが空のため読み飛ばしました");
          continue;
        }
        entries.push({ r, id, code });
      }
      if (entries.length === 0) {
        warnings.push(`「${SHEET_PROJECTS}」シートにデータ行がないため、案件は変更しません`);
      } else {
        const byId = new Map(current.projects.map((p) => [p.id, p]));
        const claimed = new Set<ID>();
        for (const e of entries) {
          if (!e.id) continue;
          const p = byId.get(e.id);
          if (!p) warnings.push(at(sh.name, e.r.rowNo) + `ID「${e.id}」は存在しないため、案件コードで照合します`);
          else if (claimed.has(p.id)) warnings.push(at(sh.name, e.r.rowNo) + `ID「${e.id}」が重複しています。案件コードで照合します`);
          else {
            e.existing = p;
            claimed.add(p.id);
          }
        }
        for (const e of entries) {
          if (e.existing) continue;
          const p = current.projects.find((x) => !claimed.has(x.id) && key(x.code) === key(e.code));
          if (p) {
            e.existing = p;
            claimed.add(p.id);
          }
        }
        const next: Project[] = [];
        const seenCodes = new Map<string, number>();
        for (const e of entries) {
          const { r, existing } = e;
          const w = (msg: string) => warnings.push(at(sh.name, r.rowNo) + msg);
          const dupRow = seenCodes.get(key(e.code));
          if (dupRow !== undefined) w(`案件コード「${e.code}」が ${dupRow}行目と重複しています（アサインは先の行の案件に割り当てます）`);
          else seenCodes.set(key(e.code), r.rowNo);

          let name = r.text("name");
          if (!name) {
            name = existing?.name ?? e.code;
            if (!existing) w("案件名が空のため、案件コードを案件名にしました");
          }

          let amount = parseNumberCell(r.get("amount"));
          if (amount === null || amount < 0) {
            if (r.text("amount")) w(`受注金額「${r.text("amount")}」を数値として読めません`);
            amount = existing?.amount ?? 0;
            if (!existing) w("受注金額が未設定のため 0 にしました");
          }

          let start = parseMonthCell(r.get("start"));
          let end = parseMonthCell(r.get("end"));
          if (!start && r.text("start")) w(`開始「${r.text("start")}」を YYYY-MM として読めません`);
          if (!end && r.text("end")) w(`終了「${r.text("end")}」を YYYY-MM として読めません`);
          start = start ?? existing?.startMonth ?? end;
          end = end ?? existing?.endMonth ?? start;
          if (!start || !end) {
            w("開始・終了が読めないため、この案件を読み飛ばしました");
            continue;
          }
          if (start > end) {
            w(`開始 ${start} が終了 ${end} より後のため入れ替えました`);
            [start, end] = [end, start];
          }

          const required: RequiredRole[] = [];
          const reqText = r.text("required");
          if (reqText) {
            for (const raw of reqText.split(/[,、，\n]+/)) {
              const item = key(raw);
              if (!item) continue;
              const m = /^(.+?)\s*(?:[×xX*]\s*(\d+))?\s*(?:[(（]\s*([^)）]*?)\s*人月\s*[)）])?$/.exec(item);
              if (!m || !m[1].trim()) {
                w(`必要役割「${item}」を読めません（例: PM×1 (2.5人月), 開発メンバー×3 (12人月)）`);
                continue;
              }
              const count = m[2] === undefined ? 1 : Number(m[2]);
              if (count <= 0) continue;
              let manMonths = defaultManMonths(count, { startMonth: start, endMonth: end });
              if (m[3] !== undefined) {
                const n = Number(m[3]);
                if (m[3] !== "" && Number.isFinite(n) && n > 0) manMonths = roundManMonths(n);
                else w(`必要役割「${item}」の必要人月を読めないため、人数 × 案件の月数（${manMonths}人月）にしました`);
              }
              const st = findStatus(m[1]);
              const dup = required.find((x) => x.statusId === st.id);
              if (dup) {
                dup.count += count;
                dup.manMonths = roundManMonths(dup.manMonths + manMonths);
              } else required.push({ statusId: st.id, count, manMonths });
            }
          }

          let color = existing?.color ?? PALETTE[(current.projects.length + next.length) % PALETTE.length];
          const colorText = key(r.text("color"));
          if (colorText) {
            if (/^#?[0-9a-fA-F]{6}$/.test(colorText)) color = colorText.startsWith("#") ? colorText : `#${colorText}`;
            else w(`色「${colorText}」は #RRGGBB 形式ではないため無視しました`);
          }

          const note = r.text("note");
          next.push({
            id: existing?.id ?? uid("p_"),
            code: e.code,
            name,
            amount,
            startMonth: start,
            endMonth: end,
            required,
            color,
            ...(note ? { note } : {}),
          });
        }
        const prevById = new Map(current.projects.map((p) => [p.id, p]));
        const nextIds = new Set(next.map((p) => p.id));
        for (const p of next) {
          const prev = prevById.get(p.id);
          if (!prev) {
            report.projects.added++;
            report.projects.addedNames.push(`${p.code} ${p.name}`);
          } else if (
            prev.code !== p.code || prev.name !== p.name || prev.amount !== p.amount ||
            prev.startMonth !== p.startMonth || prev.endMonth !== p.endMonth || prev.color !== p.color ||
            (prev.note ?? "") !== (p.note ?? "") ||
            JSON.stringify(prev.required) !== JSON.stringify(p.required)
          ) {
            report.projects.updated++;
          }
        }
        for (const p of current.projects) {
          if (!nextIds.has(p.id)) {
            report.projects.removed++;
            report.projects.removedNames.push(`${p.code} ${p.name}`);
          }
        }
        projects = next;
      }
    }
  }

  /* ===== アサイン ===== */
  const memberIds = new Set(members.map((m) => m.id));
  const projectIds = new Set(projects.map((p) => p.id));
  let months: MonthKey[] = [];
  const imported: Assignment[] = [];
  if (!wsAssign) {
    warnings.push(`「${SHEET_ASSIGN}」シートがないため、アサインは変更しません`);
  } else {
    const sh = readSheet(wsAssign, { id: ["ID"], member: ["メンバー", "名前"] });
    const monthCols: Array<{ col: number; month: MonthKey }> = [];
    for (const { col, value } of sh.headerCells) {
      const t = cellText(value);
      const m = value instanceof Date ? dateToMonth(value) : /^\d{4}-\d{2}$/.test(t) ? t : null;
      if (m && !monthCols.some((x) => x.month === m)) monthCols.push({ col, month: m });
    }
    if (monthCols.length === 0) {
      warnings.push(`「${SHEET_ASSIGN}」シートの見出しに月（YYYY-MM）がないため、アサインは変更しません`);
    } else if (!sh.cols.has("id") && !sh.cols.has("member")) {
      warnings.push(`「${SHEET_ASSIGN}」シートに「ID」「メンバー」列がないため、アサインは変更しません`);
    } else {
      months = monthCols.map((x) => x.month).sort();
      if (months.length !== 12) warnings.push(`「${SHEET_ASSIGN}」シートの月の列が ${months.length} 個です（通常は 12 ヶ月）`);
      const memberById = new Map(members.map((m) => [m.id, m]));
      const projectByCode = new Map<string, Project>();
      for (const p of projects) if (!projectByCode.has(key(p.code))) projectByCode.set(key(p.code), p);
      const prevByKey = new Map(current.assignments.map((a) => [`${a.month}|${a.memberId}|${a.projectId}`, a]));
      const importedByKey = new Map<string, Assignment>();
      const seenMembers = new Map<ID, number>();
      const ws = wsAssign;
      const hpm = hoursPerMonthOf(current);
      const { min: hMin, max: hMax } = hoursRange(hpm);

      for (const r of sh.rows) {
        const id = r.text("id");
        const name = r.text("member");
        if (!id && ([...TOTAL_ROW_LABELS, ...LEGACY_TOTAL_ROW_LABELS] as string[]).includes(name)) continue;
        const row = ws.getRow(r.rowNo);
        const cells = monthCols.map((mc) => ({ month: mc.month, text: cellText(row.getCell(mc.col).value) }));
        const hasContent = cells.some((c) => c.text);
        if (!id && !name) {
          if (hasContent) warnings.push(at(sh.name, r.rowNo) + "ID・メンバー名が空のため読み飛ばしました");
          continue;
        }
        let member = id ? memberById.get(id) : undefined;
        if (!member && name) {
          const cands = members.filter((m) => key(m.name) === key(name));
          if (cands.length > 1) warnings.push(at(sh.name, r.rowNo) + `メンバー「${name}」が複数いるため、最初の人に割り当てます`);
          member = cands[0];
        }
        if (!member) {
          warnings.push(at(sh.name, r.rowNo) + `メンバー「${name || id}」が見つからないため、この行のアサインを読み飛ばしました`);
          continue;
        }
        const dupRow = seenMembers.get(member.id);
        if (dupRow !== undefined) warnings.push(at(sh.name, r.rowNo) + `メンバー「${member.name}」は ${dupRow}行目にもあります。両方の行を取り込みます`);
        else seenMembers.set(member.id, r.rowNo);

        for (const { month, text } of cells) {
          if (!text) continue;
          for (const rawLine of text.split(/[\r\n,、;]+/)) {
            const line = key(rawLine);
            if (!line) continue;
            const w = (msg: string) => warnings.push(at(sh.name, r.rowNo, ` ${month}`) + msg);
            const m = ASSIGNMENT_LINE_RE.exec(line);
            if (!m) {
              w(`「${line}」を読めないため読み飛ばしました（書式: 案件コード [役割] 工数h　例: PRJ-2026-001 [PL] 80h）`);
              continue;
            }
            const [, code, statusName, ratioText, hoursText] = m;
            const project = projectByCode.get(key(code));
            if (!project) {
              w(`案件コード「${code}」が見つからないため読み飛ばしました`);
              continue;
            }
            // 工数は時間に揃えて検証する（旧形式の按分は ratio × 1人月時間 に換算）
            let hours = hpm;
            let given = "";
            let clamped = false;
            if (hoursText !== undefined) {
              hours = Number(hoursText);
              given = `${hoursText}h`;
            } else if (ratioText !== undefined) {
              hours = Number(ratioText) * hpm;
              given = `按分 ${ratioText}（${Number.isFinite(hours) ? ratioToHours(Number(ratioText), hpm) : "?"}h）`;
            }
            if (!Number.isFinite(hours)) {
              w(`工数「${hoursText ?? ratioText}」を数値として読めないため読み飛ばしました`);
              continue;
            }
            if (hours > hMax) {
              w(`工数 ${given} は上限 ${hMax}h を超えるため ${hMax}h にしました`);
              hours = hMax;
              clamped = true;
            } else if (hours < hMin) {
              w(`工数 ${given} は下限 ${hMin}h 未満のため ${hMin}h にしました`);
              hours = hMin;
              clamped = true;
            }
            // 旧形式の按分は書かれた値をそのまま使う（時間経由の誤差を避ける）
            let ratio = ratioText !== undefined && !clamped ? Number(ratioText) : hours / hpm;
            let statusId: ID | undefined;
            if (statusName !== undefined && statusName.trim()) statusId = findStatus(statusName).id;

            const k = `${month}|${member.id}|${project.id}`;
            const prev = prevByKey.get(k);
            // 出力時に丸めた時間（0.1h 単位）が同じなら元の精度を保つ
            if (prev && ratioToHours(prev.ratio, hpm) === ratioToHours(ratio, hpm)) ratio = prev.ratio;
            if (importedByKey.has(k)) w(`案件「${project.code}」が同じ月に重複しているため、後の記述を採用しました`);
            const a: Assignment = {
              id: prev?.id ?? importedByKey.get(k)?.id ?? uid("a_"),
              month,
              memberId: member.id,
              projectId: project.id,
              ...(statusId ? { statusId } : {}),
              ratio,
            };
            importedByKey.set(k, a);
          }
        }
      }
      imported.push(...importedByKey.values());
    }
  }
  const monthSet = new Set(months);
  report.assignments.months = months;
  report.assignments.previous = current.assignments.filter((a) => monthSet.has(a.month)).length;
  const kept = current.assignments.filter((a) => !monthSet.has(a.month)).map((a) => ({ ...a }));
  let assignments = [...kept, ...imported].filter((a) => memberIds.has(a.memberId) && projectIds.has(a.projectId));

  /* ===== 整合性チェック（孤児 ID の除去） ===== */
  const roleIds = new Set(roles.map((r) => r.id));
  const statusIds = new Set(statuses.map((s) => s.id));
  const fallbackRole = [...roles].sort((a, b) => b.level - a.level)[0];
  for (const m of members) {
    if (!roleIds.has(m.roleId) && fallbackRole) m.roleId = fallbackRole.id;
    if (m.parentId && !memberIds.has(m.parentId)) m.parentId = null;
  }
  for (const p of projects) p.required = p.required.filter((r) => statusIds.has(r.statusId));
  assignments = assignments.map((a) => {
    if (a.statusId && !statusIds.has(a.statusId)) {
      const { statusId: _drop, ...rest } = a;
      return rest;
    }
    return a;
  });
  report.assignments.count = assignments.filter((a) => monthSet.has(a.month)).length;

  const db: DB = {
    version: current.version,
    roles,
    members,
    roleStatuses: statuses,
    projects,
    assignments,
    settings: { ...current.settings },
  };
  return { db, report };
}
