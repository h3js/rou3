import { describe, it, expect } from "vitest";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

describe("benchmark", () => {
  it("bundle size", async () => {
    const code = /* js */ `
      import { createRouter, addRoute, findRoute, findAllRoutes } from "../../src";
      createRouter();
      addRoute();
      findRoute();
      findAllRoutes();
    `;
    const { bytes, gzipSize } = await getBundleSize(code);
    console.log("bundle size", { bytes, gzipSize });
    // Budget bumped from 5.9kb/2.26kb (+~270B/+~115B): findAllRoutes now orders
    // same-node siblings by specificity so it agrees with compiled matchAll
    // regardless of insertion order (#187). Previous bump was for #184.
    // regExpToRoute() is tree-shakeable, so it does not affect this budget.
    // routeNodeKeys() likewise: it only reuses createRouter/addRoute (already in
    // this bundle) and is dropped entirely when unimported — measured identical
    // with and without its `src/index.ts` re-export.
    // +~15B: getParamRegexp() now escapes only literal dots *outside* (...) groups
    // so a `.` inside a regex constraint (`:id(\d+\.\d+)`) stays verbatim instead
    // of being double-escaped; gzip is unchanged (2383).
    // -~40B raw / +~50B gzip: findRoute's end-of-path optional fallback now
    // scans all same-node siblings (not just the first-inserted entry) via a
    // shared helper with a zero-allocation single-sibling fast path —
    // deduplication shrinks raw size, but the filter loop adds tokens the old
    // duplicated blocks gzipped away.
    // -~4B raw / +~6B gzip: findRoute's regex-param filter is now a single
    // closure-free pass (~1.4x faster than the old double `.find`) and
    // splitPath no longer rest-copies the split array — the unique loop
    // tokens gzip worse than the old repeated `.find` closures.
    // +~46B raw / +~59B gzip: addRoute is ~2x faster — encodeEscapes,
    // expandGroupDelimiters, expandModifiers and decodeEscaped bail out early
    // when the path lacks their trigger char (`\`, `{`, `?+*` suffix,
    // `\uFFFD`), and the five chained escape replaces collapsed into one
    // callback pass (shrinks raw, but the repetitive chain gzipped better).
    // +~125B raw / +~52B gzip: findRoute now selects same-node siblings by the
    // shared specificity-weight model (regex count + required-last on dynamic
    // terminals, ties first-registered) so single-match agrees with compiled
    // and findAllRoutes; a failed regex falls through instead of aborting,
    // and out-of-bounds segments no longer coerce to a literal "undefined"
    // static key. Includes a single-sibling fast path that keeps lookup speed
    // at parity.
    // +~210B raw / +~95B gzip: param names accept `[\w-]+` but a capture group
    // name must be an identifier, so `_group-names.ts` encodes the ones that
    // aren't (`-`, leading digit) into a reserved injective form and decodes
    // them back when groups are read — `:file-name.json` / `:id(\d+)` with such
    // a name used to throw `SyntaxError: Invalid capture group name` at addRoute.
    // +~56B raw / +~13B gzip: addRoute/removeRoute split route patterns with
    // splitRoute(), which drops *all* trailing empty segments, so `/a//` is
    // registered as `/a` (#193). Keeping just one (splitPath) left the tree, the
    // ctx.static key and the compiled static dispatch each matching a different
    // set of paths. Lookup paths still use splitPath (one popped empty segment,
    // i.e. `/a//` reaches `/a` but `/a///` does not) — unchanged.
    // +~77B raw / +~41B gzip: addRoute stamps a registration identity on each
    // MethodData (the rewritten segment join for plain patterns, the
    // pre-expansion text for optional/group ones) so removeRoute can splice
    // one same-node sibling without touching the others (#201, #202).
    // +~90B raw / +~30B gzip: expandedRouteId() normalizes that pre-expansion
    // text (trailing empties, escaped statics) so `/a/:x?/` removes `/a/:x?`.
    // +~1900B raw / +~715B gzip: segments after `**` (`/**\/_payload.json`,
    // `/**.md`, #212): addRoute stores them in a reversed suffix trie on the
    // wildcard node (plus `hasSuffix` flags for pruning), lookup walks it from
    // the end of the path, and on paths such a route matches findRoute and
    // findAllRoutes rank every match from the last segment backwards (the tree
    // order alone let broader routes win). Routers without such routes pay one
    // `hasSuffix` read per lookup.
    // +~45B raw / +~30B gzip: rankFromEnd skips the segments both `**` cover,
    // so a comparison costs the route, not the path (a 4000-segment path with
    // 20 nested `**` routes and one suffix route: ~2.8ms -> ~0.1ms).
    // +~31B raw / +~21B gzip: the "only one `**`" error quotes the pattern as
    // written (not `/a/**:x/b/**`, the rewrite of `/a/:x+/b/**`) and names
    // `:name+` / `:name*` as catch-alls too.
    // +~244B raw / +~95B gzip: addRoute rejects a `(` that does not close in
    // its own segment (`/files/(2024`, #199, or a `/` inside a constraint:
    // `:id([^/]+)`) with a `rou3:` error; `new RegExp` threw a raw
    // `SyntaxError` naming internal group names.
    // +~66B raw / +~71B gzip: a node's method-agnostic ("") entries are
    // siblings of its method-scoped ones (`methodEntries`, `_selectMatcher`
    // with an allocation-free two-pass loop): a method-scoped entry no longer
    // hides them from findRoute or findAllRoutes.
    // +~542B raw / +~296B gzip: addRoute rejects pattern syntax with no
    // meaning yet (unbalanced / nested `{}`, `{…}+` / `{…}*`, a modifier on
    // anything but a whole-segment `:name`, a constraint + `+` / `*`, empty
    // and `(?` groups, invalid and duplicate param names) with `rou3:` errors;
    // it was accepted with a wrong meaning or threw a raw `SyntaxError`.
    // +~35B raw / +~24B gzip: findRoute's static fast path and `params: false`
    // (both APIs) return fresh `{ data }` objects instead of the router's
    // internal (shared, mutable) entries, and findAllRoutes omits `params` on
    // static matches like compiled.
    // +~183B raw / +~80B gzip: any `\x` is a literal `x` in static keys and
    // param segments alike (the tree kept the `\` of `\.`, and `\\` before a
    // `:` / `(` was misread), and a `\/`, a trailing `\` and anchors or
    // look-arounds in a constraint throw: they made `routeToRegExp` match
    // fewer paths than the router (#227).
    // +~69B raw / +~44B gzip: regex chars outside a group in a dynamic segment
    // (`*$`, `^:id`, `x|:y`, a stray `)`) are literals, and a backreference in
    // a constraint throws (review of #228: both made the regex match less).
    // +~94B raw / +~25B gzip: param names are `[A-Za-z_]\w*` (a `-` ends one,
    // a digit can't start one, a non-ASCII char can't follow one), and a raw
    // `?` in a static segment, a mid-segment `**` and an unnamed group inside
    // a constraint throw (URLPattern alignment, #229); a `:` inside a group
    // (`(?:…)`) is no param.
    // +~58B raw / +~37B gzip: a nested `(?<name>…)` in a constraint throws
    // too, a `?` guard skips the static-segment scan, and the modifier error
    // names the escape (review of #229).
    // +~271B raw / +~126B gzip: a `:name` / `:name+` needs a value, as in
    // URLPattern (#229): `emptyParam` rejects matches that give one `""`,
    // `findRoute` sends paths with an empty segment through the
    // `findAllRoutes` walk (`_findRanked`, so the tree walk never checks), and
    // `:name*` marks its `**:name` expansion, which may still be empty.
    // +~68B raw / +~25B gzip: addRoute rejects U+FFFD-U+FFFF, the internal
    // placeholders a route could write as syntax (`\uFFFD0` as an escaped `:`,
    // the `:name*` marker).
    // +~13B raw / +~4B gzip: `**:name?` throws (it read the `**` as text
    // before the param and gave an undeclared `_`).
    // +~62B raw / +~35B gzip: a `{` / `}` ends a param name, as in URLPattern
    // (`scanFirstGroup` escapes a name char after one; `/:a{b}?` was `:ab`).
    // +1B: a `$` right after a name throws (part of it in URLPattern).
    // +~20B raw / +~2B gzip: the modifier error says where `?` and `+` / `*`
    // go (it said a whole-segment `:name` for all three, wrong for `pre-:x?`).
    // +18B raw / +6B gzip: an invalid param name is quoted without `\`s
    // (`/a/**:x{s}?` named `x\s`, an escape `scanFirstGroup` added).
    // +32B raw / +17B gzip: the modifier error names `:name(…)` and says no
    // modifier follows a `**:name` (it read as wrong for `/p/**:i?`).
    // +39B raw / +18B gzip: the quoted name drops only the `\` a group put
    // before a name char outside a constraint (`**:x(\d+)` read `x(d+)`) and
    // decodes the escape placeholders (`**:x\:y` read `x\uFFFD0y`).
    // +~314B raw / +~149B gzip: literal pattern text is percent-encoded like
    // URLPattern (`encodeLiteral`, in static keys and `getParamRegexp`), so a
    // route matches the encoded pathname `new URL()` gives (`/café` was never
    // reachable). Includes a `test` early bail and a per-char gate that keep
    // `addRoute` on plain routes as fast as before.
    // -~79B raw / -~38B gzip: `:name*` expands to a plain `**:name` (it never
    // captures `""`, as in URLPattern), so its marker and the `empty` slot in
    // `paramsMap` are gone.
    expect(bytes).toBeLessThanOrEqual(10790); // <10.79kb
    expect(gzipSize).toBeLessThanOrEqual(4520); // <4.52kb
  });
});

async function getBundleSize(code: string) {
  const res = await build({
    bundle: true,
    metafile: true,
    write: false,
    minify: true,
    format: "esm",
    platform: "node",
    outfile: "index.mjs",
    stdin: {
      contents: code,
      resolveDir: fileURLToPath(new URL(".", import.meta.url)),
      sourcefile: "index.mjs",
      loader: "js",
    },
  });
  const { bytes } = res.metafile.outputs["index.mjs"];
  const gzipSize = zlib.gzipSync(res.outputFiles[0].text).byteLength;
  return { bytes, gzipSize };
}
