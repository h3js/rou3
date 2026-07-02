import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { routeToRegExp } from "../src/index.ts";
import { regexpCases, PCRE2_DUPLICATE_NAME_ROUTES } from "./_regexp-cases.ts";

// Validate that routeToRegExp() output is understood by real PCRE-compatible
// engines. We probe a matrix of external CLI tools and run whichever are
// actually installed (and prove they support `(?<name>...)` PCRE syntax).

type CompileResult = "ok" | "error";

interface PcreTool {
  name: string;
  // PCRE2-family engines reject duplicate named groups unless PCRE2_DUPNAMES is
  // set; Perl accepts them. See PCRE2_DUPLICATE_NAME_ROUTES.
  strictDuplicateNames: boolean;
  compile: (source: string) => CompileResult;
  match: (source: string, input: string) => boolean;
}

interface Run {
  status: number | null;
  ok: boolean; // spawned without ENOENT / crash
}

function run(
  cmd: string,
  args: string[],
  opts: { input?: string; env?: NodeJS.ProcessEnv } = {},
): Run {
  const r = spawnSync(cmd, args, {
    input: opts.input ?? "",
    env: opts.env,
    encoding: "utf8",
  });
  return { status: r.status, ok: !r.error };
}

// grep -P / rg -P / pcre2grep share the same exit convention:
// 0 = match, 1 = no match, 2 = pattern (compile) error.
function grepLike(
  cmd: string,
  patternArgs: (src: string) => string[],
): Omit<PcreTool, "name" | "strictDuplicateNames"> {
  return {
    compile(source) {
      const r = run(cmd, patternArgs(source), { input: "" });
      return r.ok && r.status !== 2 ? "ok" : "error";
    },
    match(source, input) {
      const r = run(cmd, patternArgs(source), { input });
      return r.ok && r.status === 0;
    },
  };
}

const perl: Omit<PcreTool, "name" | "strictDuplicateNames"> = {
  compile(source) {
    const r = run("perl", ["-e", "qr/$ENV{RE}/; 1"], { env: { ...process.env, RE: source } });
    return r.ok && r.status === 0 ? "ok" : "error";
  },
  match(source, input) {
    const r = run("perl", ["-e", "exit(($ENV{S} =~ /$ENV{RE}/) ? 0 : 1)"], {
      env: { ...process.env, RE: source, S: input },
    });
    return r.ok && r.status === 0;
  },
};

const php: Omit<PcreTool, "name" | "strictDuplicateNames"> = (() => {
  const script =
    "$d=chr(1);$r=@preg_match($d.$argv[1].$d,$argv[2]);echo $r===false?'E':($r?'1':'0');";
  const call = (source: string, input: string) => {
    const r = spawnSync("php", ["-r", script, "--", source, input], { encoding: "utf8" });
    return r.error ? null : r.stdout;
  };
  return {
    compile: (source) =>
      call(source, "") === null ? "error" : call(source, "") === "E" ? "error" : "ok",
    match: (source, input) => call(source, input) === "1",
  };
})();

const CANDIDATES: PcreTool[] = [
  { name: "grep -P", strictDuplicateNames: true, ...grepLike("grep", (s) => ["-Pq", "-e", s]) },
  { name: "rg -P", strictDuplicateNames: true, ...grepLike("rg", (s) => ["-Pq", "-e", s]) },
  { name: "pcre2grep", strictDuplicateNames: true, ...grepLike("pcre2grep", (s) => ["-q", s]) },
  { name: "pcregrep", strictDuplicateNames: true, ...grepLike("pcregrep", (s) => ["-q", s]) },
  { name: "perl", strictDuplicateNames: false, ...perl },
  { name: "php", strictDuplicateNames: true, ...php },
];

// A tool qualifies only if it is installed AND supports `(?<name>...)` PCRE
// syntax with the expected match semantics. This auto-excludes tools that are
// missing (ENOENT) or use a different flavor (e.g. macOS BSD grep without -P,
// or Python `re` which needs `(?P<name>)`).
function isUsable(tool: PcreTool): boolean {
  const sane = "^(?<a>x)$";
  try {
    return tool.compile(sane) === "ok" && tool.match(sane, "x") && !tool.match(sane, "y");
  } catch {
    return false;
  }
}

const tools = CANDIDATES.filter(isUsable);

describe("routeToRegExp PCRE compatibility", () => {
  if (tools.length === 0) {
    it.skip("no usable PCRE-compatible CLI found (grep -P / rg -P / pcre2grep / perl / php)", () => {});
    return;
  }

  it(`detected PCRE engines: ${tools.map((t) => t.name).join(", ")}`, () => {
    expect(tools.length).toBeGreaterThan(0);
  });

  for (const tool of tools) {
    describe(tool.name, () => {
      for (const [route, { match }] of Object.entries(regexpCases)) {
        const source = routeToRegExp(route).source;
        const isDuplicateName = PCRE2_DUPLICATE_NAME_ROUTES.has(route);

        if (isDuplicateName && tool.strictDuplicateNames) {
          it(`rejects duplicate-name output for "${route}"`, () => {
            // Documents the one known PCRE2 incompatibility.
            expect(tool.compile(source)).toBe("error");
          });
          continue;
        }

        it(`compiles and matches "${route}"`, () => {
          expect(tool.compile(source), `${tool.name} should compile ${source}`).toBe("ok");
          for (const [input] of match) {
            expect(
              tool.match(source, input),
              `${tool.name} should match ${JSON.stringify(input)}`,
            ).toBe(true);
          }
        });
      }
    });
  }
});
