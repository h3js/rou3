/**
 * Turn a `RegExp` construction failure into a route-pattern error.
 *
 * Called only after `new RegExp()` has already thrown for one of the route's
 * dynamic segments, so it never rejects a pattern the engine accepts — it only
 * chooses the wording. The engine's own message names a *rewritten* segment
 * (`/^(?<__rou3_unnamed_0>2024$/: Unterminated group` on V8, `missing )` on
 * JavaScriptCore, nothing a route author wrote), so the diagnosis is made by
 * scanning the caller's original route instead: escape- and character-class
 * aware, engine-independent, and route-level — a balanced constraint that
 * contains `/` (`/:path(.+/.+)`) is split in two before any segment is
 * compiled, so no per-segment check can tell it from an unbalanced `(`.
 *
 * The result is a `SyntaxError` (what `new RegExp` threw, so `instanceof`
 * classification is unchanged) carrying the native error as `cause`. Anything
 * that is not a `SyntaxError` (group-delimiter errors, ...) is returned as is.
 */
export function routePatternError(route: string, err: unknown): unknown {
  if (!(err instanceof SyntaxError)) return err;
  let d = 0,
    cls = false,
    slash = false,
    close = false;
  for (let i = 0; i < route.length; i++) {
    const c = route.charCodeAt(i);
    if (c === 92 /* \ */) i++;
    else if (cls) cls = c !== 93 /* ] */;
    else if (c === 91 /* [ */) cls = true;
    else if (c === 40 /* ( */) d++;
    else if (c === 41 /* ) */ && d > 0) d--;
    else if (c === 41) close = true;
    else if (c === 47 /* / */ && d > 0) slash = true;
  }
  const paren = !cls && (slash || d > 0 || close);
  // An open class swallows everything after it, so it is reported first.
  // eslint-disable-next-line unicorn/no-nested-ternary
  const detail = cls
    ? "unterminated '[' character class"
    : slash
      ? "a '(...)' constraint cannot contain '/'"
      : d > 0
        ? "unbalanced '(' group"
        : close
          ? "unmatched ')'"
          : err.message;
  return new SyntaxError(
    `Invalid route pattern "${route}": ${detail}.${
      paren ? ' Escape a literal parenthesis as \\( ("\\\\(" in a JS string).' : ""
    }`,
    { cause: err },
  );
}
