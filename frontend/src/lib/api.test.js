import { buildProgramColorMap, PROGRAM_COLORS } from "./api";

describe("buildProgramColorMap", () => {
  test("assigns a color to each unique program id", () => {
    const map = buildProgramColorMap([{ id: "a" }, { id: "b" }]);
    expect(map.a).toBeDefined();
    expect(map.b).toBeDefined();
    expect(map.a).not.toBe(map.b);
  });

  test("accepts plain id strings, not just {id} objects", () => {
    const map = buildProgramColorMap(["a", "b"]);
    expect(map.a).toBeDefined();
    expect(map.b).toBeDefined();
  });

  test("is deterministic regardless of input order", () => {
    const map1 = buildProgramColorMap([{ id: "b" }, { id: "a" }]);
    const map2 = buildProgramColorMap([{ id: "a" }, { id: "b" }]);
    expect(map1.a).toBe(map2.a);
    expect(map1.b).toBe(map2.b);
  });

  test("de-duplicates repeated ids", () => {
    const map = buildProgramColorMap([{ id: "a" }, { id: "a" }, { id: "b" }]);
    expect(Object.keys(map)).toHaveLength(2);
  });

  test("cycles the palette once there are more programs than colors", () => {
    // Zero-padded so string sort order matches numeric order — ids are sorted
    // internally, and the color assignment cycles by that sorted position.
    const ids = Array.from({ length: PROGRAM_COLORS.length + 2 }, (_, i) => ({ id: `p${String(i).padStart(3, "0")}` }));
    const map = buildProgramColorMap(ids);
    const first = `p${"0".padStart(3, "0")}`;
    const wrapped = `p${String(PROGRAM_COLORS.length).padStart(3, "0")}`;
    // The 1st and (palette-length + 1)th programs must land on the same color.
    expect(map[first]).toBe(map[wrapped]);
  });

  test("empty input returns an empty map", () => {
    expect(buildProgramColorMap([])).toEqual({});
  });
});
