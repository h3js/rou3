/**
 * A dynamic segment's regex (as `getParamRegexp` builds it) read back as a
 * sequence of pieces: a literal char (`string`), a capture that takes any
 * value (`1`, a `:name`: `[^/]+?`) or any value or none (`0`, a `*` or an
 * optional `:name?`), or a constraint (an anchored `RegExp` of its group,
 * compared by source). `undefined` when the source has another form (a
 * regex built elsewhere): no claim is made then.
 *
 * The tree holds `linearRegExp`'s form of it, read back first: a `:name`
 * taking up to its text (`[^/][^/.]*`, `[^/](?:(?!-ab-)[^/])*`, or one char
 * before a capture) is `[^/]+?` again, and a `*`'s look-around (`(?=…(?<=(…)))`
 * in front, `(?=\1$)` after it) goes. Each rewritten regex matches what the
 * original does, and `[^/]` is never in a constraint, so the pieces are the
 * original's. Any other look-around means no claim (it may see past its
 * piece).
 */
type Piece = string | 0 | 1 | RegExp;

/**
 * Whether segment regex `x` certainly matches every segment `y` matches
 * (`y` may be `nonEmpty`, a `:name`). Sound, not complete: `x`'s pieces
 * must take `y`'s in order, a literal the same literal, a capture any run of
 * pieces (`1` one that can't be empty), a constraint the same constraint or
 * a run of literals it tests true on. A segment holds no `/`, so a capture
 * takes whatever a constraint of `y` gives it.
 */
export function segmentCovers(x: RegExp, y: RegExp, nonEmpty: RegExp): boolean {
  const X = _pieces(x);
  const Y = y === nonEmpty ? [1 as const] : _pieces(y);
  if (!X || !Y) return false;
  const memo = new Map<number, boolean>();
  // Whether `X[i..]` covers `Y[j..]`
  const covers = (i: number, j: number): boolean => {
    const id = i * (Y.length + 1) + j;
    let result = memo.get(id);
    if (result === undefined) {
      result = _covers(X, Y, i, j, covers);
      memo.set(id, result);
    }
    return result;
  };
  return covers(0, 0);
}

function _covers(
  X: Piece[],
  Y: Piece[],
  i: number,
  j: number,
  covers: (i: number, j: number) => boolean,
): boolean {
  if (i === X.length) return j === Y.length;
  const x = X[i];
  if (typeof x === "string") return Y[j] === x && covers(i + 1, j + 1);
  if (x instanceof RegExp) {
    const y = Y[j];
    if (y instanceof RegExp && y.source === x.source && covers(i + 1, j + 1)) return true;
    // A run of literals the constraint matches
    let text = "";
    for (let k = j; ; k++) {
      if (x.test(text) && covers(i + 1, k)) return true;
      if (typeof Y[k] !== "string") return false;
      text += Y[k];
    }
  }
  // A capture: any run of `Y`'s pieces (`1`: one that can't be empty)
  let empty = true;
  for (let k = j; k <= Y.length; k++) {
    if ((x === 0 || !empty) && covers(i + 1, k)) return true;
    const y = Y[k];
    if (y === 1 || typeof y === "string" || (y instanceof RegExp && !y.test(""))) empty = false;
  }
  return false;
}

// Pieces are stable per RegExp instance
const _cache = new WeakMap<RegExp, Piece[] | undefined>();

// A `:name` (`[^\x2f]+?` where `joinGroup` constrained it), alone or optional
// in place (`(?:(?<x>[^/]+?))?`), and a `*`
const ANY = /^(\(\?:)?\(\?<[^>]+>\[\^(?:\\?\/|\\x2f)\]\+\?\)(\))?$/;
const STAR = /^\(\?<[^>]+>\[\^\\?\/\]\*\)$/;

function _pieces(r: RegExp): Piece[] | undefined {
  if (_cache.has(r)) return _cache.get(r);
  let pieces: Piece[] | undefined = [];
  let s = r.source;
  // `linearRegExp`'s `*` (the look-around a `*` before params gets)
  if (s.startsWith("^(?=[^/]*$(?<=(")) {
    s = "^" + s.slice(_groupEnd(s, 1) + 1).replace("(?=\\1$)", "");
  }
  // `linearRegExp`'s `:name`
  s = s.replace(
    /\[\^\/\](?:\[\^\/(?:\\[\s\S]|[^\]\\])*\]\*|\(\?:\(\?!(?:\\[\s\S]|[^)\\])*\)\[\^\/\]\)\*)?\)/g,
    "[^/]+?)",
  );
  if (r.flags || s[0] !== "^" || s[s.length - 1] !== "$") pieces = undefined;
  for (let i = 1; pieces && i < s.length - 1; i++) {
    const c = s[i];
    if (c === "\\") {
      // An escaped literal (`\.`); a class escape (`\d`) is no literal
      if (/[\w]/.test(s[i + 1])) pieces = undefined;
      else pieces.push(s[++i]);
    } else if (c === "(") {
      const end = _groupEnd(s, i);
      if (end < 0) {
        pieces = undefined;
        break;
      }
      // An optional group (`(?:(?<x>…))?`, an in-place optional param)
      const optional = s[end + 1] === "?";
      const group = s.slice(i, end + 1);
      // A look-around may see past its piece
      if (/^\(\?<?[=!]/.test(group)) {
        pieces = undefined;
        break;
      }
      const any = ANY.exec(group);
      pieces.push(
        any && !any[1] === !any[2] && !any[1] === !optional
          ? optional
            ? 0
            : 1
          : STAR.test(group)
            ? 0
            : // Compared by source: without the param's name
              new RegExp(
                `^${group.replace(/^(\(\?:)?\(\?<[^>]+>/, "$1(?:")}${optional ? "?" : ""}$`,
              ),
      );
      i = end + (optional ? 1 : 0);
    } else if ("^$|.*+?[]{}()".includes(c)) {
      pieces = undefined;
    } else {
      pieces.push(c);
    }
  }
  _cache.set(r, pieces);
  return pieces;
}

/** The index of the `)` closing the group opened at `start`, or -1. */
function _groupEnd(s: string, start: number): number {
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (c === "\\") {
      i++;
    } else if (c === "[") {
      while (++i < s.length && s[i] !== "]") if (s[i] === "\\") i++;
    } else if (c === "(") {
      depth++;
    } else if (c === ")" && --depth === 0) {
      return i;
    }
  }
  return -1;
}
