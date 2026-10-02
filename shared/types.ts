/** 共通データモデル。フロント・サーバ双方がこのファイルを正とする。 */

export type ID = string;
/** "YYYY-MM" */
export type MonthKey = string;

export interface Role {
  id: ID;
  name: string;
  /** 小さいほど上位。部長=0, 課長=1, 課長代理=2, 主任=3, メンバー=4 */
  level: number;
  color: string;
}

export interface Member {
  id: ID;
  name: string;
  roleId: ID;
  /** 上長。null はルート（部長など） */
  parentId: ID | null;
  /** 兄弟内の並び順 */
  order: number;
  note?: string;
}

/** 案件で必要な役割（PM / PL / 開発メンバー / 開発BP …）。追加可能 */
export interface RoleStatus {
  id: ID;
  name: string;
  color: string;
  order: number;
}

export interface RequiredRole {
  statusId: ID;
  count: number;
}

export interface Project {
  id: ID;
  code: string;
  name: string;
  /**
   * 受注金額（円、案件全体の契約額）。入力値をそのまま保持・表示するだけで、
   * 稼働（ratio / 時間）と掛け合わせる等の計算には使わない
   */
  amount: number;
  startMonth: MonthKey;
  endMonth: MonthKey;
  required: RequiredRole[];
  color: string;
  note?: string;
}

export interface Assignment {
  id: ID;
  month: MonthKey;
  memberId: ID;
  projectId: ID;
  /** 案件内での役割 */
  statusId?: ID;
  /** 稼働按分（1人月に対する割合。既定 1）。UI では時間（ratio × hoursPerMonth）で入出力する */
  ratio: number;
}

export interface Settings {
  companyName: string;
  /** 年度開始月 1-12（既定 4） */
  fiscalYearStartMonth: number;
  currency: "JPY";
  /** 1人月あたりの時間（既定 160h）。UI の工数入力・表示と Excel の「80h」表記の換算に使う */
  hoursPerMonth: number;
}

export interface DB {
  version: number;
  roles: Role[];
  members: Member[];
  roleStatuses: RoleStatus[];
  projects: Project[];
  assignments: Assignment[];
  settings: Settings;
}

/* ---------- ユーティリティ（純関数、両環境で利用） ---------- */

/** 1人月の時間の既定値 */
export const DEFAULT_HOURS_PER_MONTH = 160;

/** 設定の 1人月時間（未設定・不正値なら 160） */
export function hoursPerMonthOf(src: { settings?: Partial<Settings> } | undefined): number {
  const h = src?.settings?.hoursPerMonth;
  return typeof h === "number" && Number.isFinite(h) && h > 0 ? h : DEFAULT_HOURS_PER_MONTH;
}

/** ratio（人月）→ 時間（小数 1 桁に丸め） */
export function ratioToHours(ratio: number, hpm: number): number {
  return Math.round(ratio * hpm * 10) / 10;
}

/** 時間 → ratio（人月）。丸めずにそのまま保持する */
export function hoursToRatio(hours: number, hpm: number): number {
  return hours / hpm;
}

/** 1アサインあたりの許容工数（時間）: 1h 〜 2 × 1人月時間（残業込み） */
export function hoursRange(hpm: number): { min: number; max: number } {
  return { min: 1, max: hpm * 2 };
}

export function monthKey(year: number, month1to12: number): MonthKey {
  return `${year}-${String(month1to12).padStart(2, "0")}`;
}

export function parseMonth(key: MonthKey): { year: number; month: number } {
  const [y, m] = key.split("-").map(Number);
  return { year: y, month: m };
}

export function addMonths(key: MonthKey, delta: number): MonthKey {
  const { year, month } = parseMonth(key);
  const idx = year * 12 + (month - 1) + delta;
  return monthKey(Math.floor(idx / 12), (idx % 12) + 1);
}

export function compareMonth(a: MonthKey, b: MonthKey): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 年度に含まれる 12 ヶ月を返す（例: 2026年度, 開始4月 → 2026-04 … 2027-03） */
export function fiscalMonths(fiscalYear: number, startMonth: number): MonthKey[] {
  const first = monthKey(fiscalYear, startMonth);
  return Array.from({ length: 12 }, (_, i) => addMonths(first, i));
}

/** ある月がどの年度に属するか */
export function fiscalYearOf(key: MonthKey, startMonth: number): number {
  const { year, month } = parseMonth(key);
  return month >= startMonth ? year : year - 1;
}

export function isWithin(key: MonthKey, start: MonthKey, end: MonthKey): boolean {
  return compareMonth(key, start) >= 0 && compareMonth(key, end) <= 0;
}

/** メンバーを階層順（深さ優先・order 順）に並べ、深さを付与 */
export function flattenTree(members: Member[]): Array<{ member: Member; depth: number; path: Member[] }> {
  const byParent = new Map<ID | null, Member[]>();
  for (const m of members) {
    const list = byParent.get(m.parentId) ?? [];
    list.push(m);
    byParent.set(m.parentId, list);
  }
  for (const list of byParent.values()) list.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "ja"));
  const out: Array<{ member: Member; depth: number; path: Member[] }> = [];
  const visit = (parentId: ID | null, depth: number, path: Member[]) => {
    for (const m of byParent.get(parentId) ?? []) {
      const p = [...path, m];
      out.push({ member: m, depth, path: p });
      visit(m.id, depth + 1, p);
    }
  };
  visit(null, 0, []);
  // 孤児（親が存在しない）はルート扱いで末尾に
  const seen = new Set(out.map((o) => o.member.id));
  for (const m of members) if (!seen.has(m.id)) out.push({ member: m, depth: 0, path: [m] });
  return out;
}

export function uid(prefix = ""): ID {
  const rnd = Math.random().toString(36).slice(2, 8);
  return `${prefix}${Date.now().toString(36)}${rnd}`;
}

export const DEFAULT_ROLES: Role[] = [
  { id: "role_bucho", name: "部長", level: 0, color: "#b0423a" },
  { id: "role_kacho", name: "課長", level: 1, color: "#3b4a6b" },
  { id: "role_kacho_dairi", name: "課長代理", level: 2, color: "#5b6b8c" },
  { id: "role_shunin", name: "主任", level: 3, color: "#7f8aa3" },
  { id: "role_member", name: "メンバー", level: 4, color: "#a9b0c0" },
];

export const DEFAULT_ROLE_STATUSES: RoleStatus[] = [
  { id: "st_pm", name: "PM", color: "#e4572e", order: 0 },
  { id: "st_pl", name: "PL", color: "#f3a712", order: 1 },
  { id: "st_dev", name: "開発メンバー", color: "#17bebb", order: 2 },
  { id: "st_bp", name: "開発BP", color: "#76b041", order: 3 },
];

export function emptyDB(): DB {
  return {
    version: 1,
    roles: DEFAULT_ROLES,
    members: [],
    roleStatuses: DEFAULT_ROLE_STATUSES,
    projects: [],
    assignments: [],
    settings: { companyName: "Office-A", fiscalYearStartMonth: 4, currency: "JPY", hoursPerMonth: 160 },
  };
}

/* ---------- Excel 取り込みレポート ---------- */

export interface ImportEntityReport {
  added: number;
  updated: number;
  removed: number;
  addedNames: string[];
  removedNames: string[];
}

export interface ImportReport {
  members: ImportEntityReport;
  projects: ImportEntityReport;
  assignments: {
    /** 取り込み後、対象月に存在するアサイン件数 */
    count: number;
    /** 取り込み前、対象月に存在したアサイン件数 */
    previous: number;
    /** 置き換え対象の月（アサインシートの見出し） */
    months: MonthKey[];
  };
  /** 新規作成された役職名 */
  rolesAdded: string[];
  /** 新規作成された案件内役割名 */
  statusesAdded: string[];
  warnings: string[];
}
