import { useMemo, useState } from "react";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { compareMonth, isWithin, parseMonth, type ID, type MonthKey, type Project, type RoleStatus } from "@shared/types";
import { formatJPY, selectFiscalMonths, selectProjectFulfilment, useStore } from "@/lib/store";
import {
  Button, Chip, ColorSwatches, ConfirmPopover, Drawer, Icon, IconButton, MonthInput, NumberInput, PALETTE, Stepper, TextInput,
} from "@/components/ui";
import "./ProjectsView.css";

type SortKey = "code" | "name" | "price" | "start";
const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: "code", label: "コード" },
  { key: "name", label: "名前" },
  { key: "price", label: "単価" },
  { key: "start", label: "開始" },
];

const ease = [0.2, 0.8, 0.2, 1] as const;

export default function ProjectsView() {
  const db = useStore((s) => s.db);
  const fy = useStore((s) => s.fiscalYear);
  const addProject = useStore((s) => s.addProject);

  const months = useMemo(() => selectFiscalMonths(db, fy), [db, fy]);
  const fulfil = useMemo(() => selectProjectFulfilment(db, months), [db, months]);
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
      price: (a, b) => a.unitPrice - b.unitPrice,
      start: (a, b) => compareMonth(a.startMonth, b.startMonth),
    };
    return out.sort((a, b) => cmp[sort.key](a, b) * sort.dir);
  }, [db.projects, q, sort, onlyThisYear, months]);

  const totalPrice = useMemo(() => db.projects.reduce((s, p) => s + p.unitPrice, 0), [db.projects]);
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
      unitPrice: 1_000_000,
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
          <div className="eyebrow">Projects · {fy}年度</div>
          <h1 className="h1">案件<em>, in&nbsp;motion.</em></h1>
          <div className="page-head__meta">
            <span>登録 <b className="num">{db.projects.length}</b> 件</span>
            <span>今年度稼働 <b className="num">{activeCount}</b> 件</span>
            <span>平均単価 <b className="num">{db.projects.length ? formatJPY(totalPrice / db.projects.length) : "—"}</b></span>
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

function fulfilment(p: Project, f: Map<ID | "", number> | undefined) {
  let need = 0;
  let got = 0;
  for (const r of p.required) {
    need += r.count;
    got += Math.min(r.count, f?.get(r.statusId) ?? 0);
  }
  return { need, got, ratio: need ? got / need : 0 };
}

function ProjectCard({ project: p, months, statusMap, fulfil: f, members, onOpen, index }: {
  project: Project;
  months: MonthKey[];
  statusMap: Map<ID, RoleStatus>;
  fulfil?: Map<ID | "", number>;
  members: number;
  onOpen: () => void;
  index: number;
}) {
  const { need, got, ratio } = fulfilment(p, f);
  const state = !need ? "none" : got >= need ? "ok" : got > 0 ? "part" : "empty";
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
        <span className="num pj-card__yen">{formatJPY(p.unitPrice)}</span>
        <span className="muted small">/ 人月</span>
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
            return (
              <Chip key={r.statusId} color={st.color} count={`${have}/${r.count}`} className={have >= r.count ? "is-met" : ""}>
                {st.name}
              </Chip>
            );
          })}
        </div>
        <div className={`pj-fill pj-fill--${state}`} title={need ? `充足 ${got}/${need}` : `アサイン ${members}名`}>
          <svg viewBox="0 0 36 36" className="pj-fill__ring" aria-hidden>
            <circle cx="18" cy="18" r="15" className="pj-fill__track" />
            <motion.circle
              cx="18" cy="18" r="15"
              className="pj-fill__arc"
              initial={false}
              animate={{ pathLength: need ? ratio : 0 }}
              transition={{ duration: 0.5, ease }}
            />
          </svg>
          <span className="pj-fill__txt num">{need ? `${Math.round(ratio * 100)}` : members}</span>
          <span className="pj-fill__lbl">{need ? "充足%" : "名"}</span>
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

  const p = project;
  const up = (patch: Partial<Omit<Project, "id">>) => p && updateProject(p.id, patch);
  const invalidRange = p ? compareMonth(p.endMonth, p.startMonth) < 0 : false;
  const durationMonths = p ? (() => {
    const a = parseMonth(p.startMonth); const b = parseMonth(p.endMonth);
    return b.year * 12 + b.month - (a.year * 12 + a.month) + 1;
  })() : 0;

  const setCount = (statusId: ID, count: number) =>
    p && up({ required: p.required.map((r) => (r.statusId === statusId ? { ...r, count } : r)) });
  const removeReq = (statusId: ID) => p && up({ required: p.required.filter((r) => r.statusId !== statusId) });
  const addReq = (statusId: ID) => p && up({ required: [...p.required, { statusId, count: 1 }] });

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
            <Field label="単価" hint="1人月あたり">
              <NumberInput currency value={p.unitPrice} min={0} onChange={(unitPrice) => up({ unitPrice })} suffix="/ 人月" aria-label="単価" />
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
              <span className="num muted small">計 {p.required.reduce((s, r) => s + r.count, 0)} 名</span>
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
                        <span className="grow">{st.name}</span>
                        <Stepper value={r.count} min={1} onChange={(c) => setCount(r.statusId, c)} label={`${st.name} 人数`} />
                        <IconButton icon="close" label={`${st.name} を外す`} size="sm" variant="danger" onClick={() => removeReq(r.statusId)} />
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
