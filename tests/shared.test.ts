import { describe, expect, it } from "vitest";
import { addMonths, defaultManMonths, fiscalMonths, fiscalYearOf, flattenTree, manMonthFulfilment, projectMonthCount, roundManMonths, type Member } from "@shared/types";

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

describe("required man-months", () => {
  it("defaults to count × project months, or 1 when the period is unusable", () => {
    expect(projectMonthCount({ startMonth: "2026-04", endMonth: "2026-09" })).toBe(6);
    expect(projectMonthCount({ startMonth: "2026-10", endMonth: "2027-03" })).toBe(6);
    expect(projectMonthCount({ startMonth: "2026-09", endMonth: "2026-04" })).toBeNull();
    expect(projectMonthCount({})).toBeNull();
    expect(defaultManMonths(3, { startMonth: "2026-04", endMonth: "2026-09" })).toBe(18);
    expect(defaultManMonths(2, { startMonth: "bad", endMonth: "2026-09" })).toBe(1);
  });

  it("rounds to 2 decimals with a 0.01 floor", () => {
    expect(roundManMonths(1 / 3)).toBe(0.33);
    expect(roundManMonths(2.005 + 1e-9)).toBe(2.01);
    expect(roundManMonths(0)).toBe(0.01);
  });

  it("computes fulfilment as Σ min(assigned, required) / Σ required, capped per role", () => {
    const p = { required: [{ statusId: "a", count: 1, manMonths: 2 }, { statusId: "b", count: 1, manMonths: 2 }] };
    expect(manMonthFulfilment(p, new Map([["a", 1], ["b", 1]]))).toEqual({ need: 4, got: 2, ratio: 0.5 });
    // a の超過で b の不足を打ち消さない
    expect(manMonthFulfilment(p, new Map([["a", 5]]))!.ratio).toBe(0.5);
    expect(manMonthFulfilment(p, new Map([["a", 3], ["b", 2]]))!.ratio).toBe(1);
    expect(manMonthFulfilment({ required: [] }, new Map())).toBeNull();
  });

  it("normalizeDB fills manMonths for legacy required roles", async () => {
    const { normalizeDB } = await import("../server/storage");
    const db = normalizeDB({
      projects: [
        { id: "p1", code: "A", name: "a", amount: 0, startMonth: "2026-04", endMonth: "2026-06", color: "#000", required: [{ statusId: "st_pm", count: 2 }] },
        { id: "p2", code: "B", name: "b", amount: 0, startMonth: "", endMonth: "", color: "#000", required: [{ statusId: "st_pm", count: 2 }] },
        { id: "p3", code: "C", name: "c", amount: 0, startMonth: "2026-04", endMonth: "2026-06", color: "#000", required: [{ statusId: "st_pm", count: 1, manMonths: 2.456 }] },
      ],
    })!;
    expect(db.projects[0].required).toEqual([{ statusId: "st_pm", count: 2, manMonths: 6 }]);
    expect(db.projects[1].required).toEqual([{ statusId: "st_pm", count: 2, manMonths: 1 }]);
    expect(db.projects[2].required).toEqual([{ statusId: "st_pm", count: 1, manMonths: 2.46 }]);
  });
});
