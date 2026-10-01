import { describe, expect, it } from "vitest";
import { addMonths, fiscalMonths, fiscalYearOf, flattenTree, type Member } from "@shared/types";

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
