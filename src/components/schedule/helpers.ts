import type { Assignment, DB, MonthKey, Project } from "@shared/types";
import { isWithin, parseMonth } from "@shared/types";

export const r2 = (n: number) => Math.round(n * 100) / 100;
export const fmtRatio = (n: number) => `×${r2(n)}`;
export const monthNum = (k: MonthKey) => parseMonth(k).month;

export function currentMonthKey(): MonthKey {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** 案件がこの年度 12 ヶ月のいずれかと重なるか */
export function projectActiveIn(p: Project, months: MonthKey[]): boolean {
  return p.startMonth <= months[months.length - 1] && p.endMonth >= months[0];
}

export function projectMonthsIn(p: Project, months: MonthKey[]): MonthKey[] {
  return months.filter((m) => isWithin(m, p.startMonth, p.endMonth));
}

export function cellKey(memberId: string, month: MonthKey) {
  return `${memberId}|${month}`;
}

export function indexAssignments(db: DB, months: MonthKey[]) {
  const set = new Set(months);
  const map = new Map<string, Assignment[]>();
  for (const a of db.assignments) {
    if (!set.has(a.month)) continue;
    const k = cellKey(a.memberId, a.month);
    const l = map.get(k);
    if (l) l.push(a);
    else map.set(k, [a]);
  }
  return map;
}

export function fmtYen(n: number): string {
  return "¥" + Math.round(n).toLocaleString("ja-JP");
}

/** 1.2億 / 3,400万 のような短縮表記 */
export function fmtYenShort(n: number): string {
  const v = Math.round(n);
  if (Math.abs(v) >= 1e8) return `¥${(v / 1e8).toFixed(2).replace(/\.?0+$/, "")}億`;
  if (Math.abs(v) >= 1e4) return `¥${Math.round(v / 1e4).toLocaleString("ja-JP")}万`;
  return `¥${v.toLocaleString("ja-JP")}`;
}
