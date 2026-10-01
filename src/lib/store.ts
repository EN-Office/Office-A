/**
 * アプリ全体の状態。全データをメモリに保持し、変更を debounce してサーバへ保存する。
 * すべての view はこの store 経由でデータを読み書きすること（直接 fetch 禁止）。
 */
import { create } from "zustand";
import type { Assignment, DB, ID, Member, MonthKey, Project, Role, RoleStatus, Settings } from "@shared/types";
import { emptyDB, uid } from "@shared/types";
import { fetchDB, saveDB } from "./api";

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

export interface AppState {
  db: DB;
  loaded: boolean;
  saveState: SaveState;
  /** 表示中の年度 */
  fiscalYear: number;
  setFiscalYear: (y: number) => void;

  load: () => Promise<void>;
  /** 低レベル更新。view はなるべく下の専用アクションを使う */
  mutate: (fn: (db: DB) => void) => void;

  // members
  addMember: (input: Omit<Member, "id" | "order"> & { order?: number }) => Member;
  updateMember: (id: ID, patch: Partial<Omit<Member, "id">>) => void;
  moveMember: (id: ID, newParentId: ID | null, newIndex?: number) => void;
  removeMember: (id: ID) => void;

  // roles (役職階層)
  addRole: (input: Omit<Role, "id">) => Role;
  updateRole: (id: ID, patch: Partial<Omit<Role, "id">>) => void;
  removeRole: (id: ID) => void;

  // role statuses (案件内役割)
  addRoleStatus: (input: Omit<RoleStatus, "id" | "order">) => RoleStatus;
  updateRoleStatus: (id: ID, patch: Partial<Omit<RoleStatus, "id">>) => void;
  removeRoleStatus: (id: ID) => void;

  // projects
  addProject: (input: Omit<Project, "id">) => Project;
  updateProject: (id: ID, patch: Partial<Omit<Project, "id">>) => void;
  removeProject: (id: ID) => void;

  // assignments
  assign: (input: { month: MonthKey; memberId: ID; projectId: ID; statusId?: ID; ratio?: number }) => Assignment;
  updateAssignment: (id: ID, patch: Partial<Omit<Assignment, "id">>) => void;
  removeAssignment: (id: ID) => void;
  /** 同一メンバー・案件のアサインを月範囲にまとめて適用（期間塗り） */
  assignRange: (input: { months: MonthKey[]; memberId: ID; projectId: ID; statusId?: ID; ratio?: number }) => void;

  updateSettings: (patch: Partial<Settings>) => void;
}

let timer: ReturnType<typeof setTimeout> | undefined;
function scheduleSave(get: () => AppState, set: (p: Partial<AppState>) => void) {
  set({ saveState: "dirty" });
  clearTimeout(timer);
  timer = setTimeout(async () => {
    set({ saveState: "saving" });
    try {
      const { version } = await saveDB(get().db);
      set({ db: { ...get().db, version }, saveState: "saved" });
    } catch (e) {
      if ((e as Error).message === "conflict") {
        // 他タブ等で更新されていた場合はサーバ側を正として再読込
        const fresh = await fetchDB();
        set({ db: fresh, saveState: "error" });
      } else {
        set({ saveState: "error" });
      }
    }
  }, 400);
}

function sortSiblings(members: Member[], parentId: ID | null) {
  members
    .filter((m) => m.parentId === parentId)
    .sort((a, b) => a.order - b.order)
    .forEach((m, i) => (m.order = i));
}

export const useStore = create<AppState>((set, get) => {
  const mutate: AppState["mutate"] = (fn) => {
    const next: DB = structuredClone(get().db);
    fn(next);
    set({ db: next });
    scheduleSave(get, set);
  };

  return {
    db: emptyDB(),
    loaded: false,
    saveState: "idle",
    fiscalYear: (() => {
      const d = new Date();
      return d.getMonth() + 1 >= 4 ? d.getFullYear() : d.getFullYear() - 1;
    })(),
    setFiscalYear: (fiscalYear) => set({ fiscalYear }),

    load: async () => {
      const db = await fetchDB();
      set({ db, loaded: true, saveState: "idle" });
    },
    mutate,

    addMember: (input) => {
      const m: Member = { id: uid("m_"), order: 0, ...input };
      mutate((db) => {
        const siblings = db.members.filter((x) => x.parentId === m.parentId);
        m.order = input.order ?? siblings.length;
        db.members.push(m);
        sortSiblings(db.members, m.parentId);
      });
      return m;
    },
    updateMember: (id, patch) => mutate((db) => {
      const m = db.members.find((x) => x.id === id);
      if (m) Object.assign(m, patch);
    }),
    moveMember: (id, newParentId, newIndex) => mutate((db) => {
      const m = db.members.find((x) => x.id === id);
      if (!m || newParentId === id) return;
      // 自分の子孫への移動は禁止
      let p = newParentId;
      while (p) {
        if (p === id) return;
        p = db.members.find((x) => x.id === p)?.parentId ?? null;
      }
      const oldParent = m.parentId;
      m.parentId = newParentId;
      const siblings = db.members.filter((x) => x.parentId === newParentId && x.id !== id).sort((a, b) => a.order - b.order);
      const idx = newIndex ?? siblings.length;
      siblings.splice(idx, 0, m);
      siblings.forEach((s, i) => (s.order = i));
      if (oldParent !== newParentId) sortSiblings(db.members, oldParent);
    }),
    removeMember: (id) => mutate((db) => {
      const m = db.members.find((x) => x.id === id);
      if (!m) return;
      // 子は削除対象の親へ付け替え
      for (const c of db.members) if (c.parentId === id) c.parentId = m.parentId;
      db.members = db.members.filter((x) => x.id !== id);
      db.assignments = db.assignments.filter((a) => a.memberId !== id);
      sortSiblings(db.members, m.parentId);
    }),

    addRole: (input) => {
      const r: Role = { id: uid("role_"), ...input };
      mutate((db) => { db.roles.push(r); db.roles.sort((a, b) => a.level - b.level); });
      return r;
    },
    updateRole: (id, patch) => mutate((db) => {
      const r = db.roles.find((x) => x.id === id);
      if (r) Object.assign(r, patch);
      db.roles.sort((a, b) => a.level - b.level);
    }),
    removeRole: (id) => mutate((db) => {
      if (db.roles.length <= 1) return;
      db.roles = db.roles.filter((x) => x.id !== id);
      const fallback = db.roles[db.roles.length - 1].id;
      for (const m of db.members) if (m.roleId === id) m.roleId = fallback;
    }),

    addRoleStatus: (input) => {
      const s: RoleStatus = { id: uid("st_"), order: get().db.roleStatuses.length, ...input };
      mutate((db) => db.roleStatuses.push(s));
      return s;
    },
    updateRoleStatus: (id, patch) => mutate((db) => {
      const s = db.roleStatuses.find((x) => x.id === id);
      if (s) Object.assign(s, patch);
    }),
    removeRoleStatus: (id) => mutate((db) => {
      db.roleStatuses = db.roleStatuses.filter((x) => x.id !== id);
      for (const p of db.projects) p.required = p.required.filter((r) => r.statusId !== id);
      for (const a of db.assignments) if (a.statusId === id) delete a.statusId;
    }),

    addProject: (input) => {
      const p: Project = { id: uid("p_"), ...input };
      mutate((db) => db.projects.push(p));
      return p;
    },
    updateProject: (id, patch) => mutate((db) => {
      const p = db.projects.find((x) => x.id === id);
      if (p) Object.assign(p, patch);
    }),
    removeProject: (id) => mutate((db) => {
      db.projects = db.projects.filter((x) => x.id !== id);
      db.assignments = db.assignments.filter((a) => a.projectId !== id);
    }),

    assign: (input) => {
      const a: Assignment = { id: uid("a_"), ratio: 1, ...input };
      mutate((db) => {
        const dup = db.assignments.find((x) => x.month === a.month && x.memberId === a.memberId && x.projectId === a.projectId);
        if (dup) { Object.assign(dup, { statusId: a.statusId ?? dup.statusId, ratio: a.ratio }); a.id = dup.id; return; }
        db.assignments.push(a);
      });
      return a;
    },
    updateAssignment: (id, patch) => mutate((db) => {
      const a = db.assignments.find((x) => x.id === id);
      if (a) Object.assign(a, patch);
    }),
    removeAssignment: (id) => mutate((db) => { db.assignments = db.assignments.filter((x) => x.id !== id); }),
    assignRange: ({ months, memberId, projectId, statusId, ratio = 1 }) => mutate((db) => {
      for (const month of months) {
        const dup = db.assignments.find((x) => x.month === month && x.memberId === memberId && x.projectId === projectId);
        if (dup) { dup.ratio = ratio; if (statusId) dup.statusId = statusId; continue; }
        db.assignments.push({ id: uid("a_"), month, memberId, projectId, statusId, ratio });
      }
    }),

    updateSettings: (patch) => mutate((db) => Object.assign(db.settings, patch)),
  };
});

/* ---------- セレクタ（派生値） ---------- */

export const selectProjectMap = (db: DB) => new Map(db.projects.map((p) => [p.id, p]));
export const selectMemberMap = (db: DB) => new Map(db.members.map((m) => [m.id, m]));
export const selectRoleMap = (db: DB) => new Map(db.roles.map((r) => [r.id, r]));
export const selectStatusMap = (db: DB) => new Map(db.roleStatuses.map((s) => [s.id, s]));

/** 月売上 = Σ unitPrice × ratio */
export function monthlyRevenue(db: DB, month: MonthKey): number {
  const pm = selectProjectMap(db);
  return db.assignments
    .filter((a) => a.month === month)
    .reduce((sum, a) => sum + (pm.get(a.projectId)?.unitPrice ?? 0) * a.ratio, 0);
}

export function formatJPY(n: number): string {
  return new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 }).format(n);
}
