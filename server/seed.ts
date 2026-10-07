/** 初回起動用のサンプルデータ（決定的: 乱数・時刻依存の ID を使わない） */
import {
  DEFAULT_ROLES,
  DEFAULT_ROLE_STATUSES,
  emptyDB,
  fiscalMonths,
  fiscalYearOf,
  monthKey,
  type Assignment,
  type DB,
  type Member,
  type Project,
} from "../shared/types";

const FY_START = 4;

/** 現在日付を含む年度（fiscalYearStartMonth 基準） */
export function currentFiscalYear(startMonth = FY_START, now = new Date()): number {
  return fiscalYearOf(monthKey(now.getFullYear(), now.getMonth() + 1), startMonth);
}

export function seedDB(now = new Date()): DB {
  const fy = currentFiscalYear(FY_START, now);
  const months = fiscalMonths(fy, FY_START); // 0..11
  const db = emptyDB();

  const m = (id: string, name: string, roleId: string, parentId: string | null, order: number): Member => ({
    id,
    name,
    roleId,
    parentId,
    order,
  });
  const members: Member[] = [
    m("m01", "山田 太郎", "role_bucho", null, 0),
    m("m02", "佐藤 花子", "role_kacho", "m01", 0),
    m("m03", "鈴木 一郎", "role_kacho", "m01", 1),
    m("m04", "高橋 健太", "role_kacho_dairi", "m02", 0),
    m("m05", "田中 美咲", "role_kacho_dairi", "m03", 0),
    m("m06", "伊藤 翔", "role_shunin", "m04", 0),
    m("m07", "渡辺 彩", "role_shunin", "m04", 1),
    m("m08", "中村 大輔", "role_shunin", "m05", 0),
    m("m09", "小林 優奈", "role_member", "m06", 0),
    m("m10", "加藤 拓海", "role_member", "m06", 1),
    m("m11", "吉田 さくら", "role_member", "m07", 0),
    m("m12", "山本 蓮", "role_member", "m08", 0),
    m("m13", "松本 葵", "role_member", "m08", 1),
    m("m14", "井上 陽菜", "role_member", "m05", 1),
  ];

  const p = (
    n: number,
    name: string,
    amount: number,
    from: number,
    to: number,
    /** [statusId, 人数, 必要工数（h/月）] */
    required: Array<[string, number, number]>,
    color: string,
    note?: string,
  ): Project => ({
    id: `p${String(n).padStart(2, "0")}`,
    code: `PRJ-${fy}-${String(n).padStart(3, "0")}`,
    name,
    amount,
    startMonth: months[from],
    endMonth: months[to],
    required: required.map(([statusId, count, hoursPerMonth]) => ({ statusId, count, hoursPerMonth })),
    color,
    ...(note ? { note } : {}),
  });
  const projects: Project[] = [
    p(1, "基幹業務システム刷新", 48_000_000, 0, 5, [["st_pm", 1, 80], ["st_pl", 1, 160], ["st_dev", 3, 400]], "#e07a5f", "大手製造業向け。上期で本番切替。"),
    p(2, "ECサイトリニューアル", 26_000_000, 2, 8, [["st_pl", 1, 80], ["st_dev", 2, 240]], "#3d8bfd"),
    p(3, "物流管理アプリ開発", 32_000_000, 4, 11, [["st_pm", 1, 80], ["st_dev", 2, 240], ["st_bp", 2, 240]], "#81b29a"),
    p(4, "社内ポータル保守運用", 12_000_000, 0, 11, [["st_dev", 1, 120]], "#f2cc8f"),
    p(5, "データ分析基盤構築", 28_500_000, 6, 11, [["st_pm", 1, 80], ["st_pl", 1, 120], ["st_dev", 2, 240]], "#9b72cf"),
    p(6, "モバイル決済アプリ", 36_000_000, 8, 11, [["st_pl", 1, 160], ["st_dev", 3, 400]], "#2ec4b6"),
  ];

  // [projectId, memberId, statusId, fromIdx, toIdx, ratio]
  const plan: Array<[string, string, string, number, number, number]> = [
    ["p01", "m04", "st_pm", 0, 5, 0.5],
    ["p01", "m06", "st_pl", 0, 5, 1],
    ["p01", "m09", "st_dev", 1, 5, 1],
    ["p02", "m07", "st_pl", 2, 7, 0.5],
    ["p02", "m11", "st_dev", 3, 7, 1],
    ["p03", "m05", "st_pm", 4, 9, 0.5],
    ["p03", "m12", "st_dev", 5, 10, 1],
    ["p04", "m10", "st_dev", 0, 3, 1],
    ["p04", "m13", "st_dev", 6, 11, 0.5],
    ["p05", "m08", "st_pm", 6, 11, 0.5],
    ["p05", "m14", "st_dev", 7, 10, 1],
    ["p06", "m07", "st_pl", 8, 11, 1],
    ["p06", "m10", "st_dev", 8, 10, 1],
  ];
  const assignments: Assignment[] = [];
  for (const [projectId, memberId, statusId, from, to, ratio] of plan) {
    for (let i = from; i <= to; i++) {
      assignments.push({
        id: `a_${projectId}_${memberId}_${months[i]}`,
        month: months[i],
        memberId,
        projectId,
        statusId,
        ratio,
      });
    }
  }

  return {
    ...db,
    roles: DEFAULT_ROLES.map((r) => ({ ...r })),
    roleStatuses: DEFAULT_ROLE_STATUSES.map((s) => ({ ...s })),
    members,
    projects,
    assignments,
  };
}
