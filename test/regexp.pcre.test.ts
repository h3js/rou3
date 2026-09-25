import { afterAll, describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { ripgrep } from "ripgrep";
import { routeToRegExp } from "../src/index.ts";
import {
  regexpCases,
  LOOKAHEAD_ROUTES,
  LOOKBEHIND_ROUTES,
  SWEEP_DUPLICATE_NAME_PATTERNS,
  SWEEP_LOOKAHEAD_PATTERNS,
  SWEEP_LOOKBEHIND_PATTERNS,
  sweepPaths,
  sweepPatterns,
} from "./_regexp-cases.ts";

// Validate that routeToRegExp() output is understood by real PCRE-compatible
// engines. We probe a matrix of external CLI tools and run whichever are
// actually installed (and prove they support `(?<name>...)` PCRE syntax).

type CompileResult = "ok" | "error";

interface PcreTool {
  name: string;
  // Whether `match` sees the input whole. The grep-like tools read it line by
  // line, so an input with a `\n` can't be tested there.
  wholeInput: boolean;
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
  env?: NodeJS.ProcessEnv,
): Omit<PcreTool, "name"> {
  return {
    wholeInput: false,
    compile(source) {
      const r = run(cmd, patternArgs(source), { input: "", env });
      return r.ok && r.status !== 2 ? "ok" : "error";
    },
    match(source, input) {
      const r = run(cmd, patternArgs(source), { input, env });
      return r.ok && r.status === 0;
    },
  };
}

const perl: Omit<PcreTool, "name"> = {
  wholeInput: true,
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

const php: Omit<PcreTool, "name"> = (() => {
  const script =
    "$d=chr(1);$r=@preg_match($d.$argv[1].$d,$argv[2]);echo $r===false?'E':($r?'1':'0');";
  const call = (source: string, input: string) => {
    const r = spawnSync("php", ["-r", script, "--", source, input], { encoding: "utf8" });
    return r.error ? null : r.stdout;
  };
  return {
    wholeInput: true,
    compile: (source) =>
      call(source, "") === null ? "error" : call(source, "") === "E" ? "error" : "ok",
    match: (source, input) => call(source, input) === "1",
  };
})();

// The `ripgrep` devDependency puts its WASM `rg` (no PCRE2) on the PATH of
// package scripts; `rg -P` needs a system build, so look past node_modules.
const systemEnv = {
  ...process.env,
  PATH: (process.env.PATH || "")
    .split(delimiter)
    .filter((dir) => !dir.includes("node_modules"))
    .join(delimiter),
};

const CANDIDATES: PcreTool[] = [
  { name: "grep -P", ...grepLike("grep", (s) => ["-Pq", "-e", s]) },
  { name: "rg -P", ...grepLike("rg", (s) => ["-Pq", "-e", s], systemEnv) },
  { name: "pcre2grep", ...grepLike("pcre2grep", (s) => ["-q", s]) },
  { name: "pcregrep", ...grepLike("pcregrep", (s) => ["-q", s]) },
  { name: "perl", ...perl },
  { name: "php", ...php },
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
      for (const [route, { match, noMatch = [] }] of Object.entries(regexpCases)) {
        const source = routeToRegExp(route).source;
        it(`compiles and matches "${route}"`, () => {
          expect(tool.compile(source), `${tool.name} should compile ${source}`).toBe("ok");
          for (const [input] of match) {
            if (!tool.wholeInput && input.includes("\n")) continue;
            expect(
              tool.match(source, input),
              `${tool.name} should match ${JSON.stringify(input)}`,
            ).toBe(true);
          }
          for (const input of noMatch) {
            if (!tool.wholeInput && input.includes("\n")) continue;
            expect(
              tool.match(source, input),
              `${tool.name} should not match ${JSON.stringify(input)}`,
            ).toBe(false);
          }
        });
      }
    });
  }
});

// RE2-family engines (Go `regexp`, Rust `regex`, RE2) support `(?<name>...)`
// but no look-around and no duplicate group names. ripgrep's default engine is
// the Rust `regex` crate, so it stands in for the family. The `ripgrep` package
// is ripgrep compiled to WASM (default engine only, no PCRE2) and runs
// in-process, so this suite needs no system binary and never skips.
// `--no-config` keeps a user config from switching engines, and `--text` keeps
// binary detection from stopping at a NUL.
const re2Input = join(mkdtempSync(join(tmpdir(), "rou3-re2-")), "input.txt");

/** Run `source` over `lines` (one per input line): exit code and matched lines. */
async function re2(source: string, lines: readonly string[] = []) {
  writeFileSync(re2Input, lines.map((line) => `${line}\n`).join(""));
  const r = await ripgrep(
    ["--no-config", "--text", "--no-filename", "--no-line-number", "-e", source, re2Input],
    { buffer: true },
  );
  return { code: r.code, stderr: r.stderr, matched: new Set(r.stdout.split("\n").slice(0, -1)) };
}

describe("routeToRegExp RE2 compatibility (ripgrep, Rust regex)", () => {
  afterAll(() => rmSync(dirname(re2Input), { recursive: true, force: true }));

  it("runs the RE2-family engine", async () => {
    expect((await re2("^(?<a>x)$", ["x", "y"])).matched).toEqual(new Set(["x"]));
    // Proves this is the Rust `regex` engine, not PCRE2.
    expect((await re2("(?<=a)b")).code).toBe(2);
  });

  // ripgrep reads its input line by line, so inputs with a `\n` are skipped.
  const lines = (inputs: readonly string[]) => inputs.filter((input) => !input.includes("\n"));

  for (const [route, { match, noMatch = [] }] of Object.entries(regexpCases)) {
    const source = routeToRegExp(route).source;
    if (LOOKBEHIND_ROUTES.has(route) || LOOKAHEAD_ROUTES.has(route)) {
      it(`rejects "${route}"`, async () => {
        expect((await re2(source)).code).toBe(2);
      });
      continue;
    }
    it(`compiles and matches "${route}"`, async () => {
      const matching = lines(match.map(([input]) => input));
      const rejected = lines(noMatch);
      const r = await re2(source, [...matching, ...rejected]);
      expect(r.code, `should compile ${source}: ${r.stderr}`).not.toBe(2);
      for (const input of matching) {
        expect(r.matched.has(input), `should match ${JSON.stringify(input)}`).toBe(true);
      }
      for (const input of rejected) {
        expect(r.matched.has(input), `should not match ${JSON.stringify(input)}`).toBe(false);
      }
    });
  }

  // Every sweep regex outside the pinned look-behind, look-ahead and
  // duplicate-name sets (asserted exact in test/regexp.test.ts) compiles in
  // RE2 and matches the same paths as in JS (which the JS sweep ties to
  // `findRoute`); the pinned ones really are rejected. One run per pattern,
  // with the paths as input lines.
  it("agrees with JS on the sweep corpus", async () => {
    const paths = lines(sweepPaths());
    const mismatches: string[] = [];
    const compiled: string[] = [];
    for (const pattern of sweepPatterns()) {
      const regex = routeToRegExp(pattern);
      if (
        SWEEP_LOOKBEHIND_PATTERNS.has(pattern) ||
        SWEEP_LOOKAHEAD_PATTERNS.has(pattern) ||
        SWEEP_DUPLICATE_NAME_PATTERNS.has(pattern)
      ) {
        if ((await re2(regex.source)).code !== 2) compiled.push(pattern);
        continue;
      }
      const r = await re2(regex.source, paths);
      expect(r.code, `rg failed on ${regex.source}: ${r.stderr}`).not.toBe(2);
      for (const path of paths) {
        if (regex.test(path) !== r.matched.has(path)) {
          mismatches.push(`${pattern} ${path}`);
        }
      }
    }
    expect(mismatches).toEqual([]);
    expect(compiled, "pinned as RE2-incompatible but compiles").toEqual([]);
  });
});
