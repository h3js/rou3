import { describe, it, expect } from "vitest";
import { fromGroupName, toGroupName } from "../src/_group-names.ts";

describe("capture-group name codec", () => {
  it("passes valid identifiers through unchanged", () => {
    // The common case must stay byte-identical: escaping every name would churn
    // all existing routeToRegExp output.
    for (const name of ["id", "userId", "user_id", "_x", "a1"]) {
      expect(toGroupName(name)).toBe(name);
      expect(fromGroupName(name)).toBe(name);
    }
  });

  it("escapes names that are not valid capture-group names", () => {
    expect(toGroupName("test-id")).toBe("__rou3_esc_test_hid");
    expect(toGroupName("0")).toBe("__rou3_esc_0");
    // Reserved shapes are escaped too, so a group name maps back to one param.
    expect(toGroupName("_0")).toBe("__rou3_esc___0");
    expect(toGroupName("__rou3_unnamed_0")).toBe("__rou3_esc_____rou3__unnamed__0");
  });

  it("is injective and exactly reversible", () => {
    // The escape is a prefix code (`_` -> `__`, `-` -> `_h`), so every `_` in the
    // output opens a two-char escape and a decode can never mis-split. A `-` -> `_`
    // sanitize fails here: `a--b` decodes back as `a_b`, and `a-_b`/`a_-b` collide
    // onto one group name (a duplicate group is a SyntaxError at registration).
    const names: string[] = [];
    const alphabet = ["a", "h", "_", "-", "0"];
    const gen = (prefix: string, depth: number) => {
      if (prefix) names.push(prefix);
      if (depth === 0) return;
      for (const c of alphabet) gen(prefix + c, depth - 1);
    };
    gen("", 5);

    const byGroupName = new Map<string, string>();
    for (const name of names) {
      const group = toGroupName(name);
      // Emitted names must be valid identifiers (JS and PCRE alike)...
      expect(group, name).toMatch(/^[A-Za-z_]\w*$/);
      // ...decode back to the original name...
      expect(fromGroupName(group), name).toBe(name);
      // ...and never collide with another param name.
      expect(byGroupName.get(group) ?? name, `collision on "${group}"`).toBe(name);
      byGroupName.set(group, name);
    }
    expect(names.length).toBe(3905);
  });
});
