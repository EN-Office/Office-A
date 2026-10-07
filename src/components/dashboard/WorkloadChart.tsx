import { useEffect, useMemo, useRef, useState } from "react";
import type { MonthKey, Project } from "@shared/types";
import { fmtHours, monthNum } from "../schedule/helpers";

/** 月ごとの稼働（時間）。parts は案件別の内訳 */
export interface WorkloadDatum {
  month: MonthKey;
  /** 合計時間 */
  total: number;
  parts: { project: Project; value: number }[];
}

function niceMax(v: number): { max: number; step: number } {
  if (v <= 0) return { max: 1, step: 0.25 };
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  const max = nice * exp;
  return { max, step: max / 4 };
}

/** 月別稼働（時間）の案件別積み上げ棒グラフ */
export default function WorkloadChart({ data, nowKey }: { data: WorkloadDatum[]; nowKey: MonthKey }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(720);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(320, el.clientWidth)));
    ro.observe(el);
    setW(Math.max(320, el.clientWidth));
    return () => ro.disconnect();
  }, []);

  const H = 300;
  const m = { l: 64, r: 8, t: 12, b: 32 };
  const iw = w - m.l - m.r;
  const ih = H - m.t - m.b;
  const { max, step } = useMemo(() => niceMax(Math.max(0, ...data.map((d) => d.total))), [data]);
  const band = iw / data.length;
  const bw = Math.min(40, band * 0.62);
  const y = (v: number) => m.t + ih - (v / max) * ih;

  const hd = hover !== null ? data[hover] : null;
  const tipLeft = hover !== null ? Math.min(Math.max(m.l + band * hover + band / 2, 110), w - 110) : 0;

  return (
    <div className="dash-chart" ref={wrap}>
      <svg width={w} height={H} role="img" aria-label="月別稼働時間の案件別積み上げ棒グラフ" onMouseLeave={() => setHover(null)}>
        {[0, 1, 2, 3, 4].map((i) => {
          const v = step * i;
          return (
            <g key={i}>
              <line x1={m.l} x2={w - m.r} y1={y(v)} y2={y(v)} className={i === 0 ? "dash-axis" : "dash-grid"} />
              <text x={m.l - 10} y={y(v) + 4} textAnchor="end" className="dash-tick">{v === 0 ? "0" : fmtHours(v)}</text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const cx = m.l + band * i + band / 2;
          let acc = 0;
          return (
            <g key={d.month} onMouseEnter={() => setHover(i)} opacity={hover === null || hover === i ? 1 : 0.45} style={{ transition: "opacity .15s" }}>
              <rect x={m.l + band * i} y={m.t} width={band} height={ih} fill="transparent" />
              {hover === i && <rect x={m.l + band * i + 2} y={m.t} width={band - 4} height={ih} className="dash-hover-band" />}
              {d.parts.map((p) => {
                const y0 = y(acc);
                acc += p.value;
                const y1 = y(acc);
                return <rect key={p.project.id} x={cx - bw / 2} y={y1} width={bw} height={Math.max(0, y0 - y1 - 0.5)} fill={p.project.color} />;
              })}
              <text x={cx} y={H - 10} textAnchor="middle" className={`dash-tick ${d.month === nowKey ? "is-now" : ""}`}>
                {monthNum(d.month)}月
              </text>
            </g>
          );
        })}
      </svg>
      {hd && (
        <div className="dash-tip" style={{ left: tipLeft, top: 0 }}>
          <div className="dash-tip-h">
            <span className="dash-mono">{hd.month}</span>
            <b className="dash-mono">{fmtHours(hd.total)}</b>
          </div>
          {hd.parts.length === 0 && <div className="dash-tip-r">アサインなし</div>}
          {[...hd.parts].sort((a, b) => b.value - a.value).map((p) => (
            <div className="dash-tip-r" key={p.project.id}>
              <i style={{ background: p.project.color }} />
              <span className="dash-mono">{p.project.code}</span>
              <span className="dash-tip-v dash-mono">{fmtHours(p.value)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
