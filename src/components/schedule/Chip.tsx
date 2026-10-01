import { forwardRef } from "react";
import type { Project, RoleStatus } from "@shared/types";
import { fmtRatio } from "./helpers";

interface Props extends React.HTMLAttributes<HTMLDivElement> {
  project: Project;
  ratio?: number;
  status?: RoleStatus;
  outOfRange?: boolean;
  floating?: boolean;
  ghost?: boolean;
  handle?: React.ReactNode;
}

/** チップの見た目（ドラッグ・オーバーレイ兼用） */
export const ChipBody = forwardRef<HTMLDivElement, Props>(function ChipBody(
  { project, ratio = 1, status, outOfRange, floating, ghost, handle, className = "", ...rest },
  ref,
) {
  const cls = ["sch-chip", outOfRange && "is-out", floating && "is-floating", ghost && "is-ghost", className]
    .filter(Boolean)
    .join(" ");
  return (
    <div ref={ref} className={cls} title={outOfRange ? "契約期間外" : `${project.code} ${project.name}`} {...rest}>
      <span className="sch-chip-bar" style={{ background: project.color }} />
      <span className="sch-chip-code">{project.code}</span>
      <span className="sch-chip-name">{project.name}</span>
      {ratio !== 1 && <span className="sch-chip-ratio">{fmtRatio(ratio)}</span>}
      {status && (
        <span className="sch-chip-status" style={{ ["--st" as string]: status.color }}>
          {status.name}
        </span>
      )}
      {outOfRange && <span className="sch-chip-warn" aria-label="契約期間外">!</span>}
      {handle}
    </div>
  );
});
