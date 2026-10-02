// Linear-time forms for params sharing a segment (`routeToRegExp`, and their
// inverse for `regExpToRoute`).
//
// A param inside a segment is lazy (`[^/]+?`: the first of several takes as
// little as possible). On a path that fails after the segment, a backtracking
// engine (JS, PCRE) retries every split of it: `/:a-:b-:c` is cubic in the
// segment's length, and a greedy `*` before params is as bad (the same class
// as path-to-regexp's CVE-2024-45296). `determinize` rewrites the shapes whose
// split it can pin down without look-arounds, so they match the same paths
// with the same captures and leave no choice to retry:
//
// - A lazy param, literal text `L` (or none) and a param that can take any
//   text (`[^/]+?`, an in-place `:x?`, a `*`): the first param ends at the
//   first `L` after its first char. Where the route matches with a later `L`,
//   it matches with that one too (the next param takes the text between), so
//   the lazy param stops at the first. One char with no `L`; `[^/][^/c]*`
//   before a single char `c`; before more chars, runs of `[^/c]` between the
//   `c`s that can't start an `L` (`firstBody`), where `c` occurs in `L` only
//   first (`%20`, `-v`) or first and last (`-to-`, `--`).
// - A lazy param, then an optional `(?:c(?<y>[^/]+?))?` ending the segment
//   (`/:x{.:y}?`): the param ends at the first `c` with text after it, or
//   takes the segment: `[^/][^/c]*c??`.
// - A greedy `*`, then params separated by the same char `c` (or none), then
//   literal text up to the end of the segment: the `*` stops at the last `c`
//   the rest still matches after, so the last param holds no `c` but at its
//   ends (`c?[^/c]*[^/]`; one char with no `c`), or a later `c` would match;
//   an in-place optional one (`:x?`) none but first (`[^/][^/c]*`). Each try
//   of the `*` then fails within the next few `c`s.
//
// Other shapes keep the lazy form (see docs/reference.md "What routeToRegExp
// doesn't model"): a constraint next to a param, separators of several kinds
// (or chars) after a `*`, a lazy `*`, a constraint that can match `/`.

// One literal char of the emitted source: an escaped one (not `\/`), or one
// with no regex meaning
const LIT = String.raw`(?:\\[^\w\s/]|[^\\()[\]{}|?*+.^$/\s])`;
// The same char in a class (see `not`)
const CLS = String.raw`(?:\\[[\]\\^]|[^\\[\]\s/^])`;
const SLASH = String.raw`\\?\/`;
// A lazy param (`[^/]+?`)
const LAZY = String.raw`\(\?<(\w+)>\[\^${SLASH}\]\+\?\)`;
const ANY_LAZY = String.raw`\(\?<\w+>\[\^${SLASH}\]\+\?\)`;
// What may follow a segment: its end (`\/`, `$`, an optional segment, the
// look-behind ending), after closing groups
const SEGMENT_END = String.raw`(?:\)\??\??)*(?:${SLASH}|\$|\(\?:${SLASH}|\(\?:\(\?<=)`;
// Params that can take any text: lazy, in-place optional, a `*` (also its
// `ANY_TAIL` ending), and the last param of a `*`'s chain (in the chain only)
const ABSORB = [
  ANY_LAZY,
  String.raw`\(\?:${ANY_LAZY}\)\?`,
  String.raw`\(\?<\w+>\[\\s\\S\]\*`,
  String.raw`\(\?<\w+>\(\?:\[\\s\\S\]\*\[\^${SLASH}\]\)\?`,
  String.raw`\(\?<\w+>(?:${LIT}\?)?\[\^${SLASH}${CLS}\]\*\[\^${SLASH}\]\)`,
  String.raw`\(\?<\w+>\[\^${SLASH}\]\)`,
  String.raw`\(\?:\(\?<\w+>\[\^${SLASH}\](?:\[\^${SLASH}${CLS}\]\*)?\)\)\?`,
].join("|");
const FIRST = new RegExp(`${LAZY}(${LIT}*)(?=${ABSORB})`, "g");
const BEFORE_OPTIONAL = new RegExp(
  String.raw`${LAZY}(?=\(\?:(${LIT})${ANY_LAZY}\)\?(?!\?)${SEGMENT_END})`,
  "g",
);
const STAR_CHAIN = new RegExp(
  String.raw`(\(\?<\w+>\[\\s\\S\]\*\))(${LIT}?)((?:${ANY_LAZY}\2)*)(?:${LAZY}|\(\?:${LAZY}\)\?(?!\?))(${LIT}*)(?=${SEGMENT_END})`,
  "g",
);

/** `source` with the shapes above in their linear form. */
export function determinize(source: string): string {
  return source
    .replace(
      STAR_CHAIN,
      (_, star: string, c: string, chain: string, name: string, optional: string, rest: string) => {
        // An optional last param (`:x?`) can have none: no `c` but first
        const last = !c
          ? "[^/]"
          : optional
            ? `[^/]${not(c)}*`
            : `${chain ? `${c}?` : ""}${not(c)}*[^/]`;
        const group = `(?<${name || optional}>${last})`;
        return `${star}${c}${chain}${optional ? `(?:${group})?` : group}${rest}`;
      },
    )
    .replace(FIRST, (match, name: string, text: string) => {
      const body = firstBody(text.match(/\\?[\s\S]/g) || []);
      return body ? `(?<${name}>${body})${text}` : match;
    })
    .replace(BEFORE_OPTIONAL, (_, name: string, c: string) => {
      return `(?<${name}>[^/]${not(c)}*${c}??)`;
    });
}

/**
 * `source` with the linear forms `determinize` emits back to lazy params,
 * where it emits them exactly so (else `source` as is: a hand-written `[^/]`
 * is no `:name`).
 */
export function undeterminize(source: string): string {
  // Groups whose body is `[^/]` or starts with `[^/][^/`, then the last param
  // of a `*`'s chain (`c?[^/c]*[^/]`)
  let lazy = "";
  let from = 0;
  for (const match of source.matchAll(/\(\?<(\w+)>\[\^\\?\/\](?:\)|\[\^\\?\/)/g)) {
    const end = closingParen(source, match.index);
    if (match.index < from || end < 0) continue;
    lazy += `${source.slice(from, match.index)}(?<${match[1]}>[^/]+?)`;
    from = end + 1;
  }
  lazy = (lazy + source.slice(from)).replace(STAR_LAST, "(?<$1>[^/]+?)");
  return lazy !== source && determinize(lazy) === source ? lazy : source;
}

// The last param of a `*`'s chain, as `determinize` emits it
const STAR_LAST = new RegExp(
  String.raw`\(\?<(\w+)>(?:${LIT}\?)?\[\^${SLASH}${CLS}\]\*\[\^${SLASH}\]\)`,
  "g",
);

/**
 * The linear body of a lazy param before the literal chars `lit` and a param
 * that takes any text (see above), or `undefined` where `lit` has its first
 * char elsewhere but last.
 */
function firstBody(lit: string[]): string | undefined {
  if (lit.length === 0) return "[^/]";
  const chars = lit.map((token) => token[token.length - 1]);
  const at = chars.indexOf(chars[0], 1);
  // Runs of `[^/c]` between `c`s other than `rest` (`exact`), or not
  // starting with it
  const runs = (rest: string[], exact: boolean): string => {
    if (rest.length === 0) return exact ? `${not(lit[0])}+` : "";
    const inner = runs(rest.slice(1), exact);
    const next = inner && `|${rest[0]}${inner}`;
    return `(?:${not(lit[0], rest[0])}${not(lit[0])}*${next})?`;
  };
  if (at < 0 || at === chars.length - 1) {
    const rest = lit.slice(1, at < 0 ? undefined : -1);
    const run = at < 0 ? runs(rest, false) : runs(rest, true);
    return `[^/]${not(lit[0])}*${at < 0 && rest.length === 0 ? "" : `(?:${lit[0]}${run})*`}`;
  }
}

/**
 * `[^/…]` without the literal chars `lits`: unescaped but for `[`, `]`, `\`,
 * `^`, a `-` last
 */
function not(...lits: string[]): string {
  const chars = lits.map((lit) => lit[lit.length - 1]);
  const body = chars
    .filter((c) => c !== "-")
    .map((c) => (/[[\]\\^]/.test(c) ? `\\${c}` : c))
    .join("");
  return `[^/${body}${chars.includes("-") ? "-" : ""}]`;
}

/** The index of the `)` closing the group that opens at `at` (`-1`: none). */
function closingParen(source: string, at: number): number {
  let depth = 0;
  for (let i = at; i < source.length; i++) {
    const c = source[i];
    if (c === "\\") i++;
    else if (c === "[") {
      for (i++; i < source.length && source[i] !== "]"; i++) {
        if (source[i] === "\\") i++;
      }
    } else if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return i;
  }
  return -1;
}
