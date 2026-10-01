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
    // +~186B raw / +~74B gzip: a `?` param after a capture in its segment
    // (`*-:x?`, `:a(\d+):b?`) is compiled in place by `getParamRegexp`
    // instead of expanding into two routes, so a greedy capture before it
    // takes what it can, as in URLPattern; an absent one has no key. Its `?`
    // is kept raw past the percent-encoder (it would be a literal `%3F`).
    // +56B raw / +24B gzip: a bare `**` is an unnamed capture (`"0"`, `"1"`,
    // …) as in URLPattern, unset over zero segments (`getMatchParams` skips
    // it), also reported as the deprecated `_` alias.
    // +207B raw / +111B gzip: unnamed captures are numbered over the whole
    // pattern (URLPattern), so the route without a `{…}?` group keys them like
    // the one with it (`skipGroup`, counted by `_add` itself).
    // +67B raw / +25B gzip: early bails keep `{…}?` groups without unnamed
    // captures as fast as before (no `skipGroup` counting).
    // +~224B raw / +~119B gzip: a regex group right after a `{…}` group
    // ending in a param is an unnamed capture next to it, as in URLPattern
    // (`joinGroup` gives the param its lazy constraint, emitted as `[^/]+?`
    // only before a group; `/{:foo}(.*)` was `/:foo(.*)`), and a `?` / `+` /
    // `*` group right after a param, constraint, group or `*` throws
    // (`/*{*}` was `/**`). `skipGroup` counts a left-out group joined the
    // same way, so unnamed keys after it line up (`/:a{(\d+)}?/*`).
    // +136B raw / +60B gzip: a dynamic segment's registration identity is its
    // literal text percent-encoded like its regex (`dynamicKey`), so
    // `removeRoute` takes `/caf%C3%A9-:id` for `/café-:id`.
    // +54B raw / +20B gzip: an in-place optional after a lone `:name` / `*`
    // (`:a:b?`) is flagged `plain`, so the from-end ranking reads it as a
    // plain param (`/**\/:a:b?` beat the narrower `/b/:id`).
    // +155B raw / +70B gzip: a group holding only an optional param inside its
    // segment (`*-{:x}?`) is rewritten to `*-:x?`, as URLPattern reads it
    // (not after a `**`, which is no text).
    // +16B raw / +10B gzip: `getParamRegexp` returns the in-place optional
    // param's name and `paramsMap` keeps it, for the compiler (it read the source).
    // -98B raw / -33B gzip: `dynamicKey` left `addRoute` (`removeRoute` and
    // the overlap dedupe compare identities through `routeId`), less the wider
    // `plain` check (any capture-only segment with one required name).
    // -29B raw / -19B gzip: `expandGroupDelimiters` returns a `{:x}?` rewrite alone
    // (the caller expands the next group).
    // +~165B raw / +~83B gzip: a pattern starting with a `{…}` group gets no
    // `/` in front (`absolutePattern`); each of its expansions does unless it
    // starts with one, so `{/:a}?/b` is `/:a/b` or `/b`, not `//b`. Its
    // removal identity is marked apart from `/{…}`'s (`{a}?/b` vs `/{a}?/b`),
    // `skipGroup` counts a relative one's captures after its `/`, and text
    // right after a leading `{/…}?` (`{/a}?b`) throws.
    // +361B raw / +217B gzip: a `*` is a greedy catch-all as in URLPattern
    // (one segment or more, none after the lookup path's trailing slash):
    // `matchesZero` and the `slash` flag through both walks, a whole-segment
    // `*` on the wildcard node (the param-node end-of-path fallback is gone),
    // `splitStar` reading a `*` inside a segment as its segment-local parts
    // around a `**` and `getMatchParams` joining their captures, `**:name`
    // outweighing `*` on a shared node, and the one-catch-all error naming
    // `*`. `replaceSegmentWildcards` and `dynamicTerminal` are gone.
    // +32B raw / +18B gzip: `normalizePath` keeps the trailing slash of a
    // last `.` / `..` as WHATWG does (`/foo/bar/..` is `/foo/`, a `/foo/*`).
    // -23B raw / -15B gzip: a trailing `*` is optional again (as in 0.11),
    // so the walks no longer thread the trailing-slash flag (`matchesZero`
    // ignores it; only `getMatchParams` reads it, for the `""` capture).
    // Weights are doubled so that a `*` outweighs a `**` (a trailing one: same
    // paths) by less than a regex param.
    // Merged with main at 11935B / 5064B: the greedy `*` above is +396B raw
    // / +225B gzip on top of it.
    // +35B raw / +15B gzip: a `pre*` ending its segment also registers the
    // segment as written (ranked on its node), its `**` needing a segment.
    // +37B raw / +21B gzip: in a suffix trie a capture-only regex (`plain`)
    // weighs a point only, below a `*` (`/*/:y` over `/**/:a:b?`).
    // +7B raw / +3B gzip: the `**` of a split `*` may capture `""` (`empty`).
    // +12B raw / +7B gzip: that `**` needs a segment before more of the
    // route too (a `pre*` route is listed once per path).
    // +10B raw / +6B gzip: every segment of a `:name+` / `:name*` / `**:name`
    // needs a value, as in URLPattern (`emptyParam` tests the value for an
    // empty segment, not for `""` only; paths without one pay nothing new).
    // +635B raw / +275B gzip: a `(.*)` group is a `*` and a `:name(.*)` a `*`
    // keyed by name, as in URLPattern (`starGroups` rewrites them up front,
    // behind an `includes("(.*)")` bail; a U+FFFF before a `*` that would
    // read as a modifier, kept by `joinGroup` / `getParamRegexp`; `captureKey`
    // declares the name; `matchesZero` / `emptyParam` read `empty`, not a
    // digit name; the misplaced-modifier error names catch-alls), and a
    // capture inside a class in a constraint throws (`[(.*)]`).
    expect(bytes).toBeLessThanOrEqual(13067); // <13.07kb
    expect(gzipSize).toBeLessThanOrEqual(5616); // <5.62kb
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
