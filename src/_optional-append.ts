import { tokenize } from "./_regexp-scan.ts";

// Whether a segment regex `prefix` followed by an optional part `rest`
// (`prefix(?:rest)?`, the inline form of `{…}?` / `pre-:x?`) captures like
// the router, which registers `prefix` and `prefix` + `rest` and takes the
// one with `rest` wherever it matches. The regex tries the ways `prefix` can
// match in order, each with `rest` and then without, so it agrees unless an
// earlier way reaches the end of the segment without `rest` while a later one
// fits `rest` (`/*-x{-x}?` on `x-x-x`: the greedy `*` takes `x-x`, the
// router's `*-x-x` gives `x`). Conservative: `false` falls back to an
// alternation. It holds when:
// - every capture in `prefix` is a lazy `:name` (`[^/]+?`): tried shortest
//   first, a later value only moves text into the next capture, so the first
//   split that fits `rest` comes before any that ends the segment;
// - the two can't end with the same char (`/*-x{.png}?`), so no segment
//   matches both;
// - every capture in `prefix` can't match the literal char right after it
//   (`:id(\d+)-x{.png}?`, `:a(png|jpg)-{:b}?`, and the first char of `rest`
//   for the last one): each ends at a fixed place, so `prefix` splits a
//   segment one way only.

/** Whether `prefix(?:rest)?` captures like the router (see above). */
export function appendsCleanly(prefix: string, rest: string): boolean {
  const tokens = tokenize(prefix);
  const all = tokens.concat(tokenize(rest));
  if (tokens.every((token) => literal(token) || LAZY_NAME.test(token))) {
    return true;
  }
  const a = lastAtom(tokens);
  const b = lastAtom(all);
  const [atom, char] = literal(a) ? [b, literal(a)] : [a, literal(b)];
  if (atom && char && !matches(atom, char)) {
    return true;
  }
  return tokens.every((token, i) => {
    if (literal(token)) return true;
    const next = literal(all[i + 1]);
    const capture = CAPTURE.exec(token);
    if (!next || !capture) return false;
    const [, run, , words] = capture;
    return run ? !matches(run, next) : !words.split("|").some((word) => word.includes(next));
  });
}

const LAZY_NAME = /^\(\?<\w+>\[\^\/\]\+\?\)$/;

/**
 * A capture that is a run of one atom (`(?<x>\d+)`, `(?<x>[a-z]*)`):
 * `[, atom, , quantifier]`, or an alternation of plain words
 * (`(?<x>png|jpg)`): `[, , words]`.
 */
const CAPTURE =
  /^\(\?<\w+>(?:(\\[dwsDWS]|\[(?:\\[\s\S]|[^\\\]])*\]|\\\W|[^\\()[\]{}.*+?^$|])([*+?]|\{\d+(?:,\d*)?\})\??|([^\\()[\]{}.*+?^$|]+(?:\|[^\\()[\]{}.*+?^$|]+)*))\)$/;

/** The char a literal token stands for (`\.`, `-`), if it is one. */
function literal(token: string | undefined): string | undefined {
  if (!token) return;
  if (token.length === 2 && token[0] === "\\" && /\W/.test(token[1])) return token[1];
  if (token.length === 1 && !/[\\()[\]{}.*+?^$|]/.test(token)) return token;
}

/**
 * An atom every match of `tokens` ends with: a literal token, or the atom of
 * a capture that is a non-empty run of it (`(?<x>\d+)`).
 */
function lastAtom(tokens: string[]): string | undefined {
  const last = tokens[tokens.length - 1];
  if (literal(last)) return last;
  const capture = CAPTURE.exec(last || "");
  return capture?.[1] && /^(?:\+|\{[1-9])/.test(capture[2]) ? capture[1] : undefined;
}

/** Whether the regex atom matches the char `c`. */
function matches(atom: string, c: string): boolean {
  return new RegExp(`^${atom}$`).test(c);
}
