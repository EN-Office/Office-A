import { describe, expect, it } from "vitest";
import {
  addMonths, avgHoursPerMonth, defaultRequiredHours, fiscalMonths, fiscalYearOf, flattenTree, legacyManMonthsToHours, projectMonthCount,
  requiredFulfilment, roundRequiredHours, type Member,
} from "@shared/types";

describe("addMonths", () => {
  it("adds and subtracts across year boundaries", () => {
    expect(addMonths("2026-04", 1)).toBe("2026-05");
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2027-01", -1)).toBe("2026-12");
    expect(addMonths("2026-04", 12)).toBe("2027-04");
    expect(addMonths("2026-04", -16)).toBe("2024-12");
    expect(addMonths("2026-04", 0)).toBe("2026-04");
  });
});

describe("fiscalMonths", () => {
  it("returns 12 months starting at the fiscal start month", () => {
    const ms = fiscalMonths(2026, 4);
    expect(ms).toHaveLength(12);
    expect(ms[0]).toBe("2026-04");
    expect(ms[8]).toBe("2026-12");
    expect(ms[9]).toBe("2027-01");
    expect(ms[11]).toBe("2027-03");
  });
  it("handles January start", () => {
    expect(fiscalMonths(2026, 1)).toEqual(Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, "0")}`));
  });
});

describe("fiscalYearOf", () => {
  it("assigns months before the start month to the previous fiscal year", () => {
    expect(fiscalYearOf("2026-04", 4)).toBe(2026);
    expect(fiscalYearOf("2026-10", 4)).toBe(2026);
    expect(fiscalYearOf("2027-03", 4)).toBe(2026);
    expect(fiscalYearOf("2026-03", 4)).toBe(2025);
    expect(fiscalYearOf("2026-01", 1)).toBe(2026);
  });
});

describe("flattenTree", () => {
  const mk = (id: string, parentId: string | null, order: number, name = id): Member => ({
    id,
    name,
    roleId: "r",
    parentId,
    order,
  });

  it("orders depth-first by order and assigns depth/path", () => {
    const members = [
      mk("c2", "root", 1),
      mk("g1", "c1", 0),
      mk("root", null, 0),
      mk("c1", "root", 0),
      mk("root2", null, 1),
    ];
    const flat = flattenTree(members);
    expect(flat.map((f) => f.member.id)).toEqual(["root", "c1", "g1", "c2", "root2"]);
    expect(flat.map((f) => f.depth)).toEqual([0, 1, 2, 1, 0]);
    expect(flat[2].path.map((m) => m.id)).toEqual(["root", "c1", "g1"]);
  });

  it("breaks order ties by name", () => {
    const flat = flattenTree([mk("b", null, 0, "鈴木"), mk("a", null, 0, "佐藤")]);
    expect(flat).toHaveLength(2);
    expect(new Set(flat.map((f) => f.member.id))).toEqual(new Set(["a", "b"]));
  });

  it("appends orphans (missing parent) at the end as depth 0", () => {
    const flat = flattenTree([mk("orphan", "ghost", 0), mk("root", null, 0), mk("child", "root", 0)]);
    expect(flat.map((f) => f.member.id)).toEqual(["root", "child", "orphan"]);
    expect(flat[2].depth).toBe(0);
    expect(flat[2].path.map((m) => m.id)).toEqual(["orphan"]);
  });

  it("does not loop on cycles; cyclic members are emitted once as orphans", () => {
    const flat = flattenTree([mk("x", "y", 0), mk("y", "x", 0)]);
    expect(flat.map((f) => f.member.id).sort()).toEqual(["x", "y"]);
  });
});

describe("normalizeDB migrations", () => {
  it("moves legacy unitPrice to amount and fills hoursPerMonth", async () => {
    const { normalizeDB } = await import("../server/storage");
    const db = normalizeDB({
      projects: [{ id: "p1", code: "A", name: "a", unitPrice: 1_200_000, startMonth: "2026-04", endMonth: "2026-09", required: [], color: "#000000" }],
      settings: { companyName: "X", fiscalYearStartMonth: 4, currency: "JPY" },
    })!;
    expect(db.projects[0].amount).toBe(1_200_000);
    expect("unitPrice" in db.projects[0]).toBe(false);
    expect(db.settings.hoursPerMonth).toBe(160);
    const kept = normalizeDB({ projects: [{ id: "p2", amount: 5, unitPrice: 9 }], settings: { hoursPerMonth: 150 } })!;
    expect(kept.projects[0].amount).toBe(5);
    expect(kept.settings.hoursPerMonth).toBe(150);
  });
});

describe("required hours per month", () => {
  it("counts project months and defaults to count × hoursPerMonth", () => {
    expect(projectMonthCount({ startMonth: "2026-04", endMonth: "2026-09" })).toBe(6);
    expect(projectMonthCount({ startMonth: "2026-10", endMonth: "2027-03" })).toBe(6);
    expect(projectMonthCount({ startMonth: "2026-09", endMonth: "2026-04" })).toBeNull();
    expect(projectMonthCount({})).toBeNull();
    expect(defaultRequiredHours(1, 160)).toBe(160);
    expect(defaultRequiredHours(3, 160)).toBe(480);
    expect(defaultRequiredHours(0, 150)).toBe(150);
  });

  it("rounds to integers with a floor of 1h", () => {
    expect(roundRequiredHours(79.6)).toBe(80);
    expect(roundRequiredHours(0.2)).toBe(1);
    expect(roundRequiredHours(Number.NaN)).toBe(1);
  });

  it("converts legacy man-months over the project period to h/月", () => {
    const p = { startMonth: "2026-04", endMonth: "2026-09" }; // 6ヶ月
    expect(legacyManMonthsToHours(3, p, 160)).toBe(80);
    expect(legacyManMonthsToHours(15, p, 160)).toBe(400);
    expect(legacyManMonthsToHours(0.01, p, 160)).toBe(1);
    expect(legacyManMonthsToHours(2, { startMonth: "bad" }, 160)).toBe(320);
    expect(avgHoursPerMonth(3, p, 160)).toBe(80);
  });

  it("computes fulfilment as Σ min(assigned, required) / Σ required, capped per role", () => {
    const p = { required: [{ statusId: "a", count: 1, hoursPerMonth: 160 }, { statusId: "b", count: 1, hoursPerMonth: 160 }] };
    expect(requiredFulfilment(p, new Map([["a", 80], ["b", 80]]))).toEqual({ need: 320, got: 160, ratio: 0.5 });
    // a の超過で b の不足を打ち消さない
    expect(requiredFulfilment(p, new Map([["a", 400]]))!.ratio).toBe(0.5);
    expect(requiredFulfilment(p, new Map([["a", 240], ["b", 160]]))!.ratio).toBe(1);
    expect(requiredFulfilment({ required: [] }, new Map())).toBeNull();
  });

  it("normalizeDB migrates legacy manMonths and fills missing hoursPerMonth", async () => {
    const { normalizeDB } = await import("../server/storage");
    const proj = (id: string, startMonth: string, endMonth: string, required: unknown[]) =>
      ({ id, code: id, name: id, amount: 0, startMonth, endMonth, color: "#000", required });
    const db = normalizeDB({
      settings: { hoursPerMonth: 160 },
      projects: [
        proj("p1", "2026-04", "2026-06", [{ statusId: "st_pm", count: 2 }]),
        proj("p2", "", "", [{ statusId: "st_pm", count: 1, manMonths: 2 }]),
        proj("p3", "2026-04", "2026-06", [{ statusId: "st_pm", count: 1, manMonths: 2.456 }]),
        proj("p4", "2026-04", "2026-06", [{ statusId: "st_pm", count: 1, manMonths: 0.001 }]),
        proj("p5", "2026-04", "2026-06", [{ statusId: "st_pm", count: 1, hoursPerMonth: 79.6, manMonths: 9 }]),
      ],
    })!;
    expect(db.projects[0].required).toEqual([{ statusId: "st_pm", count: 2, hoursPerMonth: 320 }]);
    expect(db.projects[1].required).toEqual([{ statusId: "st_pm", count: 1, hoursPerMonth: 320 }]);
    expect(db.projects[2].required).toEqual([{ statusId: "st_pm", count: 1, hoursPerMonth: 131 }]);
    expect(db.projects[3].required).toEqual([{ statusId: "st_pm", count: 1, hoursPerMonth: 1 }]);
    expect(db.projects[4].required).toEqual([{ statusId: "st_pm", count: 1, hoursPerMonth: 80 }]);
    // 1人月の時間が違えばその値で換算する
    const db2 = normalizeDB({ settings: { hoursPerMonth: 150 }, projects: [proj("p1", "2026-04", "2026-06", [{ statusId: "st_pm", count: 1, manMonths: 3 }])] })!;
    expect(db2.projects[0].required[0].hoursPerMonth).toBe(150);
  });
});
