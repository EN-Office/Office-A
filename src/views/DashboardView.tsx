import { useMemo } from "react";
import { motion } from "framer-motion";
import { fiscalMonths } from "@shared/types";
import { selectStatusMap, useStore } from "../lib/store";
import RevenueChart, { type RevenueDatum } from "../components/dashboard/RevenueChart";
import { currentMonthKey, fmtYen, fmtYenShort, monthNum, projectActiveIn, r2 } from "../components/schedule/helpers";
import "../components/dashboard/dashboard.css";

const fade = (i: number) => ({
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.32, delay: i * 0.05, ease: [0.2, 0.8, 0.2, 1] as const },
});

export default function DashboardView() {
  const db = useStore((s) => s.db);
  const fiscalYear = useStore((s) => s.fiscalYear);
  const months = useMemo(() => fiscalMonths(fiscalYear, db.settings.fiscalYearStartMonth), [fiscalYear, db.settings.fiscalYearStartMonth]);
  const nowKey = currentMonthKey();
  const statusMap = useMemo(() => selectStatusMap(db), [db]);

  const d = useMemo(() => {
    const mset = new Set(months);
    const projMap = new Map(db.projects.map((p) => [p.id, p]));
    const asg = db.assignments.filter((a) => mset.has(a.month) && projMap.has(a.projectId));

    // 月 × 案件 売上
    const chart: RevenueDatum[] = months.map((month) => {
      const per = new Map<string, number>();
      for (const a of asg) if (a.month === month) per.set(a.projectId, (per.get(a.projectId) ?? 0) + projMap.get(a.projectId)!.unitPrice * a.ratio);
      const parts = db.projects.filter((p) => per.has(p.id)).map((p) => ({ project: p, value: per.get(p.id)! }));
      return { month, total: parts.reduce((s, p) => s + p.value, 0), parts };
    });
    const revenue = chart.reduce((s, c) => s + c.total, 0);

    const memberIds = new Set(db.members.map((m) => m.id));
    const asgM = asg.filter((a) => memberIds.has(a.memberId));
    const working = new Set(asgM.map((a) => a.memberId));
    const total = asgM.reduce((s, a) => s + a.ratio, 0);
    const avg = db.members.length ? total / (db.members.length * 12) : 0;

    // メンバー × 月 の Σratio
    const sums = new Map<string, number>();
    for (const a of asgM) sums.set(`${a.memberId}|${a.month}`, (sums.get(`${a.memberId}|${a.month}`) ?? 0) + a.ratio);

    const activeProjects = db.projects.filter((p) => projectActiveIn(p, months)).sort((a, b) => a.code.localeCompare(b.code));
    const projRows = activeProjects.map((p) => {
      const mine = asgM.filter((a) => a.projectId === p.id);
      const rev = mine.reduce((s, a) => s + p.unitPrice * a.ratio, 0);
      const req = p.required.map((r) => {
        const got = new Set(mine.filter((a) => a.statusId === r.statusId).map((a) => a.memberId)).size;
        return { ...r, got };
      });
      return { p, rev, req, people: new Set(mine.map((a) => a.memberId)).size };
    });

    const roleRows = db.roles.map((role) => {
      const ms = db.members.filter((m) => m.roleId === role.id);
      let sum = 0;
      for (const m of ms) for (const mo of months) sum += sums.get(`${m.id}|${mo}`) ?? 0;
      return { role, n: ms.length, avg: ms.length ? sum / (ms.length * 12) : 0 };
    });

    const free = db.members
      .map((m) => {
        const flags = months.map((mo) => (sums.get(`${m.id}|${mo}`) ?? 0) === 0);
        return { m, flags, count: flags.filter(Boolean).length };
      })
      .filter((x) => x.count > 0)
      .sort((a, b) => b.count - a.count);

    return { chart, revenue, working: working.size, avg, projRows, roleRows, free, activeCount: activeProjects.length };
  }, [db, months]);

  const kpis = [
    { label: "年間売上見込", value: fmtYenShort(d.revenue), sub: fmtYen(d.revenue) },
    { label: "案件数", value: String(d.activeCount), sub: `全 ${db.projects.length} 件中` },
    { label: "稼働人数", value: String(d.working), sub: `全 ${db.members.length} 名中` },
    { label: "平均稼働率", value: `${Math.round(d.avg * 100)}%`, sub: "全メンバー × 12ヶ月" },
  ];

  return (
    <div className="dash-root">
      <motion.header className="dash-head" {...fade(0)}>
        <div className="dash-kicker dash-mono">OVERVIEW · {months[0]} — {months[11]}</div>
        <h1 className="dash-title">{fiscalYear}年度の<i>見通し</i></h1>
      </motion.header>

      <motion.section className="dash-kpis" {...fade(1)}>
        {kpis.map((k) => (
          <div className="dash-kpi" key={k.label}>
            <div className="dash-kpi-l">{k.label}</div>
            <div className="dash-kpi-v dash-mono">{k.value}</div>
            <div className="dash-kpi-s dash-mono">{k.sub}</div>
          </div>
        ))}
      </motion.section>

      <motion.section className="dash-sec" {...fade(2)}>
        <h2 className="dash-h2">月別<i>売上</i></h2>
        <RevenueChart data={d.chart} nowKey={nowKey} />
        <ul className="dash-legend">
          {db.projects.filter((p) => d.chart.some((c) => c.parts.some((x) => x.project.id === p.id))).map((p) => (
            <li key={p.id}><i style={{ background: p.color }} /><span className="dash-mono">{p.code}</span> {p.name}</li>
          ))}
        </ul>
      </motion.section>

      <motion.section className="dash-sec" {...fade(3)}>
        <h2 className="dash-h2">案件と<i>充足状況</i></h2>
        {d.projRows.length === 0 ? (
          <div className="dash-empty">この年度に有効な案件がありません。</div>
        ) : (
          <div className="dash-table-wrap">
            <table className="dash-table">
              <thead>
                <tr>
                  <th>コード</th><th>案件名</th><th className="r">単価</th><th>期間</th><th className="r">年間売上</th><th>必要役割（アサイン人数 / 必要数）</th>
                </tr>
              </thead>
              <tbody>
                {d.projRows.map(({ p, rev, req }) => (
                  <tr key={p.id}>
                    <td className="dash-mono"><i className="dash-sw" style={{ background: p.color }} />{p.code}</td>
                    <td>{p.name}</td>
                    <td className="r dash-mono">{fmtYen(p.unitPrice)}</td>
                    <td className="dash-mono dash-period">{p.startMonth} → {p.endMonth}</td>
                    <td className="r dash-mono">{fmtYen(rev)}</td>
                    <td>
                      {req.length === 0 ? <span className="dash-muted">指定なし</span> : (
                        <div className="dash-reqs">
                          {req.map((r) => {
                            const st = statusMap.get(r.statusId);
                            const short = r.got < r.count;
                            return (
                              <div key={r.statusId} className={`dash-req ${short ? "is-short" : ""}`} title={short ? `${st?.name ?? ""} が ${r.count - r.got} 名不足` : "充足"}>
                                <span className="dash-req-n">{st?.name ?? "?"}</span>
                                <span className="dash-mono dash-req-v">{r.got}/{r.count}</span>
                                <span className="dash-meter"><i style={{ width: `${r.count ? Math.min(1, r.got / r.count) * 100 : 100}%` }} /></span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </motion.section>

      <div className="dash-cols">
        <motion.section className="dash-sec" {...fade(4)}>
          <h2 className="dash-h2">役職別<i>稼働</i></h2>
          {d.roleRows.map(({ role, n, avg }) => (
            <div className="dash-role" key={role.id}>
              <div className="dash-role-n"><i style={{ background: role.color }} />{role.name}<span className="dash-mono dash-muted">{n}名</span></div>
              <div className="dash-hbar"><motion.i initial={{ width: 0 }} animate={{ width: `${Math.min(avg, 1) * 100}%` }} transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }} className={avg > 1.0001 ? "is-over" : ""} /></div>
              <div className="dash-mono dash-role-v">{n ? `${Math.round(avg * 100)}%` : "—"}</div>
            </div>
          ))}
        </motion.section>

        <motion.section className="dash-sec" {...fade(5)}>
          <h2 className="dash-h2"><i>未アサイン</i>の月</h2>
          {d.free.length === 0 ? (
            <div className="dash-empty">空き月のあるメンバーはいません。</div>
          ) : (
            <ul className="dash-free">
              {d.free.map(({ m, flags, count }) => (
                <li key={m.id}>
                  <span className="dash-free-n">{m.name}</span>
                  <span className="dash-strip" title={months.filter((_, i) => flags[i]).map((x) => `${monthNum(x)}月`).join(" ")}>
                    {flags.map((f, i) => <i key={i} className={f ? "on" : ""} />)}
                  </span>
                  <span className="dash-mono dash-free-c">{count}<small>ヶ月</small></span>
                </li>
              ))}
            </ul>
          )}
          <p className="dash-note">合計 {r2(d.free.reduce((s, x) => s + x.count, 0))} 人月分の空き（Σ稼働率 = 0 の月）</p>
        </motion.section>
      </div>
    </div>
  );
}

