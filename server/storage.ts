/** data/db.json を単一ファイルの JSON ストアとして扱う。書込みはアトミック（tmp → rename）。 */
import fs from "node:fs";
import path from "node:path";
import { emptyDB, type DB } from "../shared/types";
import { seedDB } from "./seed";

const ARRAY_KEYS = ["roles", "members", "roleStatuses", "projects", "assignments"] as const;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 旧形式（unitPrice = 1人月単価）の案件を受注金額 amount へ移行する。値はそのまま引き継ぐ */
function migrateProject(p: Record<string, unknown>): DB["projects"][number] {
  if (!isObject(p)) return p as unknown as DB["projects"][number];
  const { unitPrice, ...rest } = p;
  const amount = typeof rest.amount === "number" && Number.isFinite(rest.amount)
    ? rest.amount
    : typeof unitPrice === "number" && Number.isFinite(unitPrice) ? unitPrice : 0;
  return { ...rest, amount } as unknown as DB["projects"][number];
}

/**
 * 最低限の形チェック。欠けている配列/設定は既定値で補う。
 * 形として DB と見なせない（オブジェクトでない・配列キーが配列以外）場合は null。
 */
export function normalizeDB(input: unknown): DB | null {
  if (!isObject(input)) return null;
  const base = emptyDB();
  for (const k of ARRAY_KEYS) {
    if (input[k] !== undefined && !Array.isArray(input[k])) return null;
  }
  if (input.settings !== undefined && !isObject(input.settings)) return null;
  const settings = { ...base.settings, ...((input.settings as Partial<DB["settings"]> | undefined) ?? {}) };
  if (typeof settings.hoursPerMonth !== "number" || !Number.isFinite(settings.hoursPerMonth) || settings.hoursPerMonth <= 0) {
    settings.hoursPerMonth = base.settings.hoursPerMonth;
  }
  const version = typeof input.version === "number" && Number.isFinite(input.version) ? input.version : base.version;
  return {
    version,
    roles: (input.roles as DB["roles"] | undefined) ?? base.roles,
    members: (input.members as DB["members"] | undefined) ?? [],
    roleStatuses: (input.roleStatuses as DB["roleStatuses"] | undefined) ?? base.roleStatuses,
    projects: ((input.projects as Array<Record<string, unknown>> | undefined) ?? []).map(migrateProject),
    assignments: (input.assignments as DB["assignments"] | undefined) ?? [],
    settings,
  };
}

export class Store {
  readonly dir: string;
  readonly file: string;
  readonly backup: string;
  private db: DB;

  constructor(dir: string) {
    this.dir = dir;
    this.file = path.join(dir, "db.json");
    this.backup = path.join(dir, "db.bak.json");
    this.db = this.load();
  }

  get(): DB {
    return this.db;
  }

  /** db を置き換えて保存する（version は呼び出し側で決める） */
  replace(next: DB): DB {
    this.db = next;
    this.save();
    return this.db;
  }

  private load(): DB {
    fs.mkdirSync(this.dir, { recursive: true });
    if (!fs.existsSync(this.file)) {
      this.db = seedDB();
      this.save();
      console.log(`[storage] created ${this.file} with seed data`);
      return this.db;
    }
    let db: DB | null = null;
    try {
      db = normalizeDB(JSON.parse(fs.readFileSync(this.file, "utf8")));
    } catch {
      db = null;
    }
    if (!db) {
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      const corrupt = path.join(this.dir, `db.corrupt-${ts}.json`);
      fs.renameSync(this.file, corrupt);
      // 直前のバックアップが読めればそれで復旧、無理なら空 DB から再開
      const restored = this.readBackup();
      console.warn(
        `[storage] ${this.file} is unreadable; moved to ${corrupt}. ` +
          (restored ? `restored from ${this.backup}` : "starting with an empty DB"),
      );
      this.db = restored ?? emptyDB();
      this.save();
      return this.db;
    }
    return db;
  }

  private readBackup(): DB | null {
    try {
      return fs.existsSync(this.backup) ? normalizeDB(JSON.parse(fs.readFileSync(this.backup, "utf8"))) : null;
    } catch {
      return null;
    }
  }

  private save(): void {
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.db, null, 2), "utf8");
    if (fs.existsSync(this.file)) fs.copyFileSync(this.file, this.backup);
    fs.renameSync(tmp, this.file);
  }
}
