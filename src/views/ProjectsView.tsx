import { useMemo, useState } from "react";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { compareMonth, isWithin, parseMonth, type ID, type MonthKey, type Project, type RoleStatus } from "@shared/types";
import {
  contractTotal, defaultManMonths, fmtMM, formatJPY, manMonthFulfilment, MIN_MAN_MONTHS, roundManMonths, selectFiscalMonths,
  selectProjectFulfilment, selectProjectManMonths, useStore,
} from "@/lib/store";
import {
  Button, Chip, ColorSwatches, ConfirmPopover, Drawer, Icon, IconButton, MonthInput, NumberInput, PALETTE, Stepper, TextInput,
} from "@/components/ui";
import "./ProjectsView.css";

type SortKey = "code" | "name" | "amount" | "start";
const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: "code", label: "コード" },
  { key: "name", label: "名前" },
  { key: "amount", label: "受注金額" },
  { key: "start", label: "開始" },
];

const ease = [0.2, 0.8, 0.2, 1] as const;

export default function ProjectsView() {
  const db = useStore((s) => s.db);
  const fy = useStore((s) => s.fiscalYear);
  const addProject = useStore((s) => s.addProject);

  const months = useMemo(() => selectFiscalMonths(db, fy), [db, fy]);
  const fulfil = useMemo(() => selectProjectFulfilment(db, months), [db, months]);
  const assignedMM = useMemo(() => selectProjectManMonths(db), [db]);
  const statusMap = useMemo(() => new Map(db.roleStatuses.map((s) => [s.id, s])), [db.roleStatuses]);
  const memberCount = useMemo(() => {
    const set = new Set(months);
    const m = new Map<ID, Set<ID>>();
    for (const a of db.assignments) {
      if (!set.has(a.month)) continue;
      const s = m.get(a.projectId) ?? new Set<ID>();
      s.add(a.memberId);
      m.set(a.projectId, s);
    }
    return m;
  }, [db.assignments, months]);

  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "code", dir: 1 });
  const [onlyThisYear, setOnlyThisYear] = useState(false);
  const [openId, setOpenId] = useState<ID | null>(null);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const first = months[0];
    const last = months[11];
    const out = db.projects.filter((p) => {
      if (needle && !`${p.code} ${p.name} ${p.note ?? ""}`.toLowerCase().includes(needle)) return false;
      if (onlyThisYear && (compareMonth(p.endMonth, first) < 0 || compareMonth(p.startMonth, last) > 0)) return false;
      return true;
    });
    const cmp: Record<SortKey, (a: Project, b: Project) => number> = {
      code: (a, b) => a.code.localeCompare(b.code, "ja", { numeric: true }),
      name: (a, b) => a.name.localeCompare(b.name, "ja"),
      amount: (a, b) => a.amount - b.amount,
      start: (a, b) => compareMonth(a.startMonth, b.startMonth),
    };
    return out.sort((a, b) => cmp[sort.key](a, b) * sort.dir);
  }, [db.projects, q, sort, onlyThisYear, months]);

  const totalAmount = useMemo(() => contractTotal(db, months), [db, months]);
  const activeCount = useMemo(
    () => db.projects.filter((p) => !(compareMonth(p.endMonth, months[0]) < 0 || compareMonth(p.startMonth, months[11]) > 0)).length,
    [db.projects, months],
  );

  const createProject = () => {
    const n = db.projects.length + 1;
    let code = `P-${String(n).padStart(3, "0")}`;
    const codes = new Set(db.projects.map((p) => p.code));
    for (let i = n; codes.has(code); i++) code = `P-${String(i + 1).padStart(3, "0")}`;
    const p = addProject({
      code,
      name: "新規案件",
      amount: 0,
      startMonth: months[0],
      endMonth: months[11],
      required: [],
      color: PALETTE[db.projects.length % PALETTE.length],
      note: "",
    });
    setOpenId(p.id);
  };

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: 1 }));

  const open = db.projects.find((p) => p.id === openId) ?? null;

  return (
    <div className="page projects">
      <header className="page-head">
        <div>
          <div className="eyebrow">{fy}年度</div>
          <h1 className="h1">案件</h1>
          <div className="page-head__meta">
            <span>登録 <b className="num">{db.projects.length}</b> 件</span>
            <span>今年度稼働 <b className="num">{activeCount}</b> 件</span>
            <span>受注金額合計 <b className="num">{formatJPY(totalAmount)}</b></span>
          </div>
        </div>
        <div className="page-head__actions">
          <Button variant="primary" icon="plus" onClick={createProject}>新規案件</Button>
        </div>
      </header>

      <div className="pj-toolbar">
        <TextInput className="pj-search" icon="search" value={q} onChange={setQ} placeholder="コード・案件名で絞り込み" aria-label="絞り込み" />
        <div className="pj-seg" role="group" aria-label="並び替え">
          <span className="eyebrow pj-seg__label">Sort</span>
          {SORTS.map((s) => (
            <button
              key={s.key}
              type="button"
              className={`pj-seg__btn ${sort.key === s.key ? "is-active" : ""}`}
              aria-pressed={sort.key === s.key}
              onClick={() => toggleSort(s.key)}
            >
              {sort.key === s.key && <motion.span layoutId="pj-sort-pill" className="pj-seg__pill" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
              <span className="pj-seg__text">{s.label}</span>
              {sort.key === s.key && <span className={`pj-seg__dir ${sort.dir < 0 ? "is-desc" : ""}`}>↑</span>}
            </button>
          ))}
        </div>
        <button type="button" className={`pj-toggle ${onlyThisYear ? "is-on" : ""}`} aria-pressed={onlyThisYear} onClick={() => setOnlyThisYear((v) => !v)}>
          <span className="pj-toggle__track"><span className="pj-toggle__knob" /></span>
          {fy}年度のみ
        </button>
        <span className="pj-count num muted">{list.length} / {db.projects.length}</span>
      </div>

      {db.projects.length === 0 ? (
        <div className="empty">
          <div className="display">案件はまだありません</div>
          <p>「新規案件」から最初の案件を作成しましょう。</p>
        </div>
      ) : list.length === 0 ? (
        <div className="empty"><div className="display">該当なし</div><p>条件に一致する案件がありません。</p></div>
      ) : (
        <LayoutGroup>
          <motion.div className="pj-grid" layout>
            <AnimatePresence initial={false} mode="popLayout">
              {list.map((p, i) => (
                <ProjectCard
                  key={p.id}
                  index={i}
                  project={p}
                  months={months}
                  statusMap={statusMap}
                  fulfil={fulfil.get(p.id)}
                  assignedMM={assignedMM.get(p.id) ?? EMPTY_MM}
                  members={memberCount.get(p.id)?.size ?? 0}
                  onOpen={() => setOpenId(p.id)}
                />
              ))}
            </AnimatePresence>
          </motion.div>
        </LayoutGroup>
      )}

      <ProjectDrawer project={open} onClose={() => setOpenId(null)} months={months} />
    </div>
  );
}

/* ================= Card ================= */

const EMPTY_MM = new Map<ID | "", number>();

/** 必要人月に対するアサイン人月のメーター（不足は赤） */
function MMMeter({ got, need }: { got: number; need: number }) {
  const short = got + 1e-9 < need;
  return (
    <span className={`pj-mm ${short ? "is-short" : "is-met"}`} title={short ? `${fmtMM(need - got)}人月 不足` : "充足"}>
      <span className="pj-mm__bar"><i style={{ width: `${need > 0 ? Math.min(1, got / need) * 100 : 100}%` }} /></span>
      <span className="pj-mm__txt num">{fmtMM(got)} / {fmtMM(need)}人月</span>
    </span>
  );
}

function ProjectCard({ project: p, months, statusMap, fulfil: f, assignedMM, members, onOpen, index }: {
  project: Project;
  months: MonthKey[];
  statusMap: Map<ID, RoleStatus>;
  fulfil?: Map<ID | "", number>;
  /** statusId → 案件全期間のアサイン人月 */
  assignedMM: Map<ID | "", number>;
  members: number;
  onOpen: () => void;
  index: number;
}) {
  // リングは人月充足率（Σ min(アサイン人月, 必要人月) / Σ 必要人月）
  const mmf = manMonthFulfilment(p, assignedMM);
  const need = mmf?.need ?? 0;
  const got = mmf?.got ?? 0;
  const ratio = mmf?.ratio ?? 0;
  const state = !mmf ? "none" : ratio >= 1 - 1e-9 ? "ok" : got > 0 ? "part" : "empty";
  const s = parseMonth(p.startMonth);
  const e = parseMonth(p.endMonth);

  return (
    <motion.article
      layout
      className="pj-card"
      style={{ "--pj": p.color } as React.CSSProperties}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0, transition: { duration: 0.28, ease, delay: Math.min(index, 12) * 0.025 } }}
      exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.15 } }}
      onClick={onOpen}
      onKeyDown={(ev) => { if (ev.key === "Enter") onOpen(); }}
      role="button"
      tabIndex={0}
      aria-label={`${p.code} ${p.name} を編集`}
    >
      <div className="pj-card__top">
        <span className="pj-card__code num"><span className="pj-card__sq" />{p.code}</span>
        <span className="pj-card__open"><Icon name="arrowUpRight" size={16} /></span>
      </div>

      <h2 className="pj-card__name">{p.name}</h2>

      <div className="pj-card__price">
        <span className="muted small">受注金額</span>
        <span className="num pj-card__yen">{formatJPY(p.amount)}</span>
      </div>

      <div className="pj-tl" aria-label={`期間 ${p.startMonth} 〜 ${p.endMonth}`}>
        <div className="pj-tl__bar">
          {months.map((m) => {
            const on = isWithin(m, p.startMonth, p.endMonth);
            const startHere = m === p.startMonth;
            const endHere = m === p.endMonth;
            return <span key={m} className={`pj-tl__seg ${on ? "is-on" : ""} ${startHere ? "is-start" : ""} ${endHere ? "is-end" : ""}`} />;
          })}
        </div>
        <div className="pj-tl__labels num">
          {months.map((m) => <span key={m}>{parseMonth(m).month}</span>)}
        </div>
        <div className="pj-tl__range num">
          {s.year}.{String(s.month).padStart(2, "0")} <span className="muted">→</span> {e.year}.{String(e.month).padStart(2, "0")}
        </div>
      </div>

      <div className="pj-card__foot">
        <div className="pj-card__roles">
          {p.required.length === 0 && <span className="muted small">必要役割 未設定</span>}
          {p.required.map((r) => {
            const st = statusMap.get(r.statusId);
            if (!st) return null;
            const have = f?.get(r.statusId) ?? 0;
            const mm = assignedMM.get(r.statusId) ?? 0;
            const met = have >= r.count && mm + 1e-9 >= r.manMonths;
            return (
              <Chip
                key={r.statusId}
                color={st.color}
                count={`${have}/${r.count} · ${fmtMM(r.manMonths)}人月`}
                className={met ? "is-met" : ""}
                title={`${st.name}: アサイン ${have}/${r.count} 名 · ${fmtMM(mm)} / ${fmtMM(r.manMonths)}人月`}
              >
                {st.name}
              </Chip>
            );
          })}
        </div>
        <div className={`pj-fill pj-fill--${state}`} title={mmf ? `人月充足 ${fmtMM(got)} / ${fmtMM(need)}人月` : `アサイン ${members}名`}>
          <svg viewBox="0 0 36 36" className="pj-fill__ring" aria-hidden>
            <circle cx="18" cy="18" r="15" className="pj-fill__track" />
            <motion.circle
              cx="18" cy="18" r="15"
              className="pj-fill__arc"
              initial={false}
              animate={{ pathLength: mmf ? ratio : 0 }}
              transition={{ duration: 0.5, ease }}
            />
          </svg>
          <span className="pj-fill__txt num">{mmf ? `${Math.floor(ratio * 100)}` : members}</span>
          <span className="pj-fill__lbl">{mmf ? "人月%" : "名"}</span>
        </div>
      </div>
    </motion.article>
  );
}

/* ================= Drawer ================= */

function ProjectDrawer({ project, onClose, months }: { project: Project | null; onClose: () => void; months: MonthKey[] }) {
  const updateProject = useStore((s) => s.updateProject);
  const removeProject = useStore((s) => s.removeProject);
  const statuses = useStore((s) => s.db.roleStatuses);
  const sortedStatuses = useMemo(() => [...statuses].sort((a, b) => a.order - b.order), [statuses]);
  const statusMap = useMemo(() => new Map(statuses.map((s) => [s.id, s])), [statuses]);
  const assignments = useStore((s) => s.db.assignments);

  const p = project;
  // 役割ごとのアサイン人月（案件の全期間）
  const assignedMM = useMemo(() => {
    const m = new Map<ID | "", number>();
    if (!p) return m;
    for (const a of assignments) if (a.projectId === p.id) m.set(a.statusId ?? "", (m.get(a.statusId ?? "") ?? 0) + a.ratio);
    return m;
  }, [assignments, p]);
  const up = (patch: Partial<Omit<Project, "id">>) => p && updateProject(p.id, patch);
  const invalidRange = p ? compareMonth(p.endMonth, p.startMonth) < 0 : false;
  const durationMonths = p ? (() => {
    const a = parseMonth(p.startMonth); const b = parseMonth(p.endMonth);
    return b.year * 12 + b.month - (a.year * 12 + a.month) + 1;
  })() : 0;

  const setCount = (statusId: ID, count: number) =>
    p && up({ required: p.required.map((r) => (r.statusId === statusId ? { ...r, count } : r)) });
  const removeReq = (statusId: ID) => p && up({ required: p.required.filter((r) => r.statusId !== statusId) });
  const setManMonths = (statusId: ID, manMonths: number) =>
    p && up({ required: p.required.map((r) => (r.statusId === statusId ? { ...r, manMonths: roundManMonths(manMonths) } : r)) });
  const addReq = (statusId: ID) => p && up({ required: [...p.required, { statusId, count: 1, manMonths: defaultManMonths(1, p) }] });
  const totalMM = p ? p.required.reduce((s, r) => s + r.manMonths, 0) : 0;
  const totalGot = p ? p.required.reduce((s, r) => s + (assignedMM.get(r.statusId) ?? 0), 0) : 0;

  const available = p ? sortedStatuses.filter((s) => !p.required.some((r) => r.statusId === s.id)) : [];

  return (
    <Drawer
      open={!!p}
      onClose={onClose}
      width={560}
      eyebrow={p ? <span className="num">{p.code}</span> : null}
      title={p ? <span className="pj-drawer__title"><span className="pj-drawer__sq" style={{ background: p.color }} />{p.name || <em>無題</em>}</span> : null}
      footer={p && (
        <>
          <ConfirmPopover
            align="start"
            message={<><b>{p.name}</b> を削除しますか？<br /><span className="muted small">関連するアサインも削除されます。</span></>}
            onConfirm={() => { removeProject(p.id); onClose(); }}
          >
            {(open) => <Button variant="ghost" icon="trash" onClick={open} className="pj-del">削除</Button>}
          </ConfirmPopover>
          <span className="grow muted small pj-autosave">変更は自動で保存されます</span>
          <Button variant="primary" onClick={onClose}>完了</Button>
        </>
      )}
    >
      {p && (
        <div className="pj-form">
          <div className="pj-form__grid">
            <Field label="コード">
              <TextInput mono value={p.code} onChange={(code) => up({ code })} aria-label="コード" />
            </Field>
            <Field label="受注金額" hint="案件全体の契約額（入力値をそのまま表示）">
              <NumberInput currency value={p.amount} min={0} onChange={(amount) => up({ amount })} aria-label="受注金額" />
            </Field>
          </div>

          <Field label="案件名">
            <TextInput className="pj-form__name" value={p.name} onChange={(name) => up({ name })} aria-label="案件名" placeholder="案件名" />
          </Field>

          <div className="pj-form__grid">
            <Field label="開始月">
              <MonthInput value={p.startMonth} onChange={(startMonth) => up({ startMonth })} aria-label="開始月" />
            </Field>
            <Field label="終了月" hint={invalidRange ? undefined : `${durationMonths} ヶ月`}>
              <MonthInput value={p.endMonth} onChange={(endMonth) => up({ endMonth })} aria-label="終了月" />
            </Field>
          </div>
          {invalidRange && <p className="pj-form__err">終了月が開始月より前になっています。</p>}
          <div className="pj-tl pj-tl--drawer" style={{ "--pj": p.color } as React.CSSProperties}>
            <div className="pj-tl__bar">
              {months.map((m) => <span key={m} className={`pj-tl__seg ${isWithin(m, p.startMonth, p.endMonth) ? "is-on" : ""}`} />)}
            </div>
            <div className="pj-tl__labels num">{months.map((m) => <span key={m}>{parseMonth(m).month}</span>)}</div>
          </div>

          <Field label="カラー">
            <ColorSwatches value={p.color} onChange={(color) => up({ color })} />
          </Field>

          <section className="pj-req">
            <div className="pj-req__head">
              <span className="eyebrow">必要役割</span>
              <span className="num muted small">
                計 {p.required.reduce((s, r) => s + r.count, 0)} 名 · アサイン {fmtMM(totalGot)} / 必要 {fmtMM(totalMM)}人月
              </span>
            </div>
            <ul className="pj-req__list">
              <AnimatePresence initial={false}>
                {p.required.map((r) => {
                  const st = statusMap.get(r.statusId);
                  if (!st) return null;
                  return (
                    <motion.li
                      key={r.statusId}
                      layout
                      className="pj-req__item"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2, ease }}
                    >
                      <span className="pj-req__inner">
                        <span className="dot" style={{ color: st.color }} />
                        <span className="grow pj-req__name">{st.name}</span>
                        <span className="pj-req__lbl">人数</span>
                        <Stepper value={r.count} min={1} onChange={(c) => setCount(r.statusId, c)} label={`${st.name} 人数`} />
                        <span className="pj-req__lbl">必要人月</span>
                        <NumberInput
                          className="pj-req__mmin"
                          value={r.manMonths}
                          min={MIN_MAN_MONTHS}
                          step={0.01}
                          decimals={2}
                          suffix="人月"
                          onChange={(v) => setManMonths(r.statusId, v)}
                          aria-label={`${st.name} 必要人月`}
                        />
                        <IconButton icon="close" label={`${st.name} を外す`} size="sm" variant="danger" onClick={() => removeReq(r.statusId)} />
                      </span>
                      <span className="pj-req__fill">
                        <MMMeter got={assignedMM.get(r.statusId) ?? 0} need={r.manMonths} />
                      </span>
                    </motion.li>
                  );
                })}
              </AnimatePresence>
            </ul>
            {available.length > 0 && (
              <div className="pj-req__add">
                <span className="muted small">追加:</span>
                {available.map((s) => (
                  <button key={s.id} type="button" className="pj-req__addbtn" style={{ "--chip": s.color } as React.CSSProperties} onClick={() => addReq(s.id)}>
                    <Icon name="plus" size={11} />{s.name}
                  </button>
                ))}
              </div>
            )}
            {sortedStatuses.length === 0 && <p className="muted small">役割ステータスは「設定」で追加できます。</p>}
          </section>

          <Field label="メモ">
            <textarea
              className="pj-form__note"
              value={p.note ?? ""}
              rows={4}
              placeholder="顧客、体制、注意点など"
              onChange={(e) => up({ note: e.target.value })}
            />
          </Field>
        </div>
      )}
    </Drawer>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="pj-field">
      <div className="pj-field__label">
        <span className="eyebrow">{label}</span>
        {hint && <span className="muted small num">{hint}</span>}
      </div>
      {children}
    </div>
  );
}
