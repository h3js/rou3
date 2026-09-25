import { ATOM } from "./_regexp-scan.ts";

// Merge the regex bodies of a route's expansions into one body in which every
// named group appears once. Node 22 (V8 12.4), PCRE2 and RE2 reject a group
// name declared twice, even in separate alternatives (#213), so the bodies of
// `/users{/:id}?/posts/:post` can't just be OR-ed: `post` is in both.
//
// A body is handled as its top-level items (a group, class, escape or char,
// with its quantifier). Every step keeps the matched language. A strict merge
// also keeps the order in which a backtracking engine tries the alternatives,
// so the captures stay those of the plain alternation (the first expansion
// wins where several match a path):
// - A common tail is factored out: `(?:a|b)T` tries what `aT|bT` does.
// - So is a common head, up to a quantified item: without one, the head has
//   a single way to match, so `H(?:a|b)` tries what `Ha|Hb` does. The
//   exceptions are optional groups whose choice the input decides anyway
//   (`countsChoice`). A head is also cut before an open-ended capture whose
//   segment goes on past it: the capture would swallow what differs
//   (`mergeCapture` takes it instead).
// - An optional or alternation item holding a shared name is split into its
//   alternatives, when nothing quantified precedes it.
// - Alternatives are only moved past ones no input can match along with them
//   (`disjoint`).
// A relaxed merge drops these order rules: the path set stays exact, but where
// several expansions match one path, another one's captures may be reported.

/**
 * `bodies` (in preference order) merged into one body with no named group
 * declared twice, or `undefined` when no merge is known for their shape.
 */
export function mergeBodies(bodies: string[], relaxed = false): string | undefined {
  const state: State = { steps: 0, origin: new Map(), relaxed };
  const alternatives = bodies.map((body, i) => {
    const alternative = splitItems(body);
    state.origin.set(alternative, i);
    return alternative;
  });
  return mergeAlternatives(alternatives, [], 0, state)?.join("");
}

/** Named groups declared in `source` (look-behinds excluded). */
export function groupNames(source: string): string[] {
  return [...source.matchAll(/\(\?<([A-Za-z_]\w*)>/g)].map((m) => m[1]);
}

type Alternative = string[];

interface State {
  /** Merge steps taken, bounded so that every merge ends. */
  steps: number;
  /** The body an alternative comes from: parts of one body pair up with other bodies first. */
  origin: Map<Alternative, number>;
  relaxed: boolean;
}

const MAX_STEPS = 256;

/**
 * Merge `alternatives`. What follows them is `rest` up to the end of its
 * segment (`undefined` when that can match a `/`), then `after` segments
 * (`undefined` when that varies).
 */
function mergeAlternatives(
  alternatives: Alternative[],
  rest: Alternative | undefined,
  after: number | undefined,
  state: State,
): Alternative | undefined {
  if (++state.steps > MAX_STEPS) return;
  alternatives = dedupe(alternatives);
  if (alternatives.length === 1) {
    return alternatives[0];
  }
  const [head, mids, tail] = factor(alternatives, after, state);
  // The tail up to its first segment boundary, then `rest` if there is none.
  const cut = tail.findIndex((item) => boundary(item));
  const segment = cut === -1 ? tail : tail.slice(0, cut);
  const midsRest = !segment.every((item) => slashFree(item))
    ? undefined
    : cut === -1
      ? rest && [...segment, ...rest]
      : segment;
  const merged = mergeMids(mids, midsRest, add(segmentCount(tail), after), state);
  return merged && [...head, ...merged, ...tail];
}

/** Merge alternatives with no common head or tail. */
function mergeMids(
  mids: Alternative[],
  rest: Alternative | undefined,
  after: number | undefined,
  state: State,
): Alternative | undefined {
  const pairs = sharedPairs(mids, after, state);
  if (!pairs) {
    return [alternation(mids)];
  }
  if (mids.length > 2) {
    // Merge two alternatives sharing a name first, next to each other
    // (`sharedPairs` has checked that `j` can move up to `i`).
    for (const [i, j] of pairs) {
      const merged = mergeAlternatives([mids[i], mids[j]], rest, after, state);
      if (!merged) continue;
      state.origin.set(merged, -state.steps);
      return mergeAlternatives(
        [...mids.slice(0, i), merged, ...mids.slice(i + 1, j), ...mids.slice(j + 1)],
        rest,
        after,
        state,
      );
    }
    return;
  }
  const captured = rest ? mergeCapture(mids[0], mids[1], rest, after, state) : undefined;
  if (captured) {
    return captured;
  }
  const expanded = expandShared(mids, state);
  return expanded && mergeAlternatives(expanded, rest, after, state);
}

/**
 * Two alternatives of one segment that start with the same named group
 * (`:name` vs `:name.:ext`, one node in the tree), followed by `rest` up to
 * the segment end: the group is declared once, and each alternative's
 * pattern is held to its own rest by a look-ahead up to the segment end, the
 * rests merged after it. The rests stay inside the segment, so whichever of
 * them then matches, the segment is one of the two alternatives'.
 */
function mergeCapture(
  a: Alternative,
  b: Alternative,
  rest: Alternative,
  after: number | undefined,
  state: State,
): Alternative | undefined {
  const groupA = /^\(\?<(\w+)>([^]*)\)$/.exec(a[0] || "");
  const groupB = /^\(\?<(\w+)>([^]*)\)$/.exec(b[0] || "");
  const restA = a.slice(1);
  const restB = b.slice(1);
  if (
    !groupA ||
    !groupB ||
    groupA[1] !== groupB[1] ||
    !restA.every((item) => slashFree(item)) ||
    !restB.every((item) => slashFree(item))
  ) {
    return;
  }
  const merged = mergeAlternatives([restA, restB], rest, after, state);
  if (!merged) return;
  const until = (pattern: string, own: Alternative) => {
    const ahead = unnamed([...own, ...rest].join(""));
    return `${wrap(pattern)}(?=${ahead ? `${ahead}(?:/|$)` : "/|$"})`;
  };
  return [`(?<${groupA[1]}>${until(groupA[2], restA)}|${until(groupB[2], restB)})`, ...merged];
}

/**
 * Split the widest optional or alternation item holding a name another
 * alternative declares into its alternatives, or `undefined` when there is
 * none (strict: after a quantified item, the split would change the order).
 */
function expandShared(mids: Alternative[], state: State): Alternative[] | undefined {
  let best: [i: number, k: number] | undefined;
  for (let i = 0; i < mids.length; i++) {
    const others = new Set(mids.flatMap((mid, j) => (j === i ? [] : groupNames(mid.join("")))));
    for (let k = 0; k < mids[i].length; k++) {
      const item = mids[i][k];
      if (
        /^\(\?:[^]*\)\?{0,2}$/.test(item) &&
        groupNames(item).some((name) => others.has(name)) &&
        (!best || item.length > mids[best[0]][best[1]].length)
      ) {
        best = [i, k];
      }
      if (!state.relaxed && quantified(item)) break;
    }
  }
  if (!best) return;
  const [i, k] = best;
  const [, inner, quantifier] = /^\(\?:([^]*)\)(\?{0,2})$/.exec(mids[i][k])!;
  const before = mids[i].slice(0, k);
  const after = mids[i].slice(k + 1);
  const branches = splitAlternation(inner).map((branch) => [
    ...before,
    ...splitItems(branch),
    ...after,
  ]);
  if (quantifier === "?") branches.push([...before, ...after]);
  else if (quantifier === "??") branches.unshift([...before, ...after]);
  for (const branch of branches) state.origin.set(branch, state.origin.get(mids[i])!);
  return [...mids.slice(0, i), ...branches, ...mids.slice(i + 1)];
}

/**
 * Split into `[head, mids, tail]`: the items all alternatives start and end
 * with (see the top of the file for which), and what differs. A head ending
 * in `/` before mids that each end in `/` (or are empty) is rotated to keep
 * whole segments together: `/a/` `(?:x/)?` `b` becomes `/a` `(?:/x)?` `/b`.
 */
function factor(
  alternatives: Alternative[],
  after: number | undefined,
  state: State,
): [Alternative, Alternative[], Alternative] {
  const first = alternatives[0];
  const min = Math.min(...alternatives.map((alternative) => alternative.length));
  let h = 0;
  while (
    h < min &&
    alternatives.every((alternative) => alternative[h] === first[h]) &&
    (state.relaxed || !quantified(first[h]) || countsChoice(alternatives, h, after))
  ) {
    h++;
  }
  // An open-ended capture whose segment goes on past the head would take
  // what differs after it (`/media/*{.webp}?` capturing `photo.webp`).
  const open = alternatives.some(
    (alternative) => h < alternative.length && !boundary(alternative[h]),
  )
    ? first.slice(0, h).findLastIndex((item) => boundary(item))
    : h;
  for (let i = open + 1; i < h; i++) {
    if (/(?:\[\^\/\]|\[\\s\\S\]|\.)[*+]\)$/.test(first[i])) {
      h = i;
    }
  }
  let t = 0;
  while (
    t < min - h &&
    alternatives.every((alternative) => alternative.at(-1 - t) === first.at(-1 - t))
  ) {
    t++;
  }
  let mids = alternatives.map((alternative) => alternative.slice(h, alternative.length - t));
  let [headEnd, tailStart] = [h, first.length - t];
  if (
    h > 0 &&
    first[h - 1] === "/" &&
    mids.every((mid) => mid.length === 0 || mid.at(-1) === "/")
  ) {
    mids = mids.map((mid) => (mid.length === 0 ? mid : ["/", ...mid.slice(0, -1)]));
    [headEnd, tailStart] = [h - 1, tailStart - 1];
  }
  for (let i = 0; i < mids.length; i++) {
    state.origin.set(mids[i], state.origin.get(alternatives[i])!);
  }
  return [first.slice(0, headEnd), mids, first.slice(tailStart)];
}

/**
 * Whether the optional group at `h` has one way to match a given input, as a
 * head without quantified items, so it can join the head: it adds a fixed
 * number of segments, and every alternative's rest after it, and what
 * follows, a same fixed number, so the path's segment count decides
 * (`/:lang?/:file{.json}?`).
 */
function countsChoice(alternatives: Alternative[], h: number, after: number | undefined): boolean {
  const group = /^\(\?:([^]*)\)\?\??$/.exec(alternatives[0][h]);
  const count = group ? segmentCount(splitItems(group[1])) : undefined;
  if (!count || after === undefined) return false;
  const rests = alternatives.map((alternative) => segmentCount(alternative.slice(h + 1)));
  return rests[0] !== undefined && rests.every((rest) => rest === rests[0]);
}

/**
 * How many segments `items` add (their top-level `/`s), or `undefined` when
 * that varies: an item other than `/` that can match a `/`.
 */
function segmentCount(items: Alternative): number | undefined {
  let count = 0;
  for (const item of items) {
    if (item === "/") count++;
    else if (!slashFree(item)) return;
  }
  return count;
}

function add(a: number | undefined, b: number | undefined): number | undefined {
  return a === undefined || b === undefined ? undefined : a + b;
}

/** Whether an item starts at a segment boundary: a `/`, or an optional group starting with one. */
function boundary(item: string): boolean {
  return item === "/" || item.startsWith("(?:/");
}

/**
 * Pairs `[i, j]` of alternatives declaring a same name, where `j` can move up
 * to `i` (strict: see `disjoint`): first those of different origins (see
 * `State`), then the rest, each the closest first. `undefined` when no two
 * alternatives declare a same name.
 */
function sharedPairs(
  mids: Alternative[],
  after: number | undefined,
  state: State,
): [number, number][] | undefined {
  let shared = false;
  const pairs: [pair: [number, number], own: boolean, closeness: number][] = [];
  for (let j = 1; j < mids.length; j++) {
    for (let i = 0; i < j; i++) {
      if (!sharesName(mids[i], mids[j])) continue;
      shared = true;
      if (!state.relaxed && !mids.slice(i + 1, j).every((mid) => disjoint(mid, mids[j], after))) {
        continue;
      }
      const own = state.origin.get(mids[i]) === state.origin.get(mids[j]);
      pairs.push([[i, j], own, closeness(mids[i], mids[j])]);
    }
  }
  if (!shared) return;
  return pairs.sort((a, b) => Number(a[1]) - Number(b[1]) || b[2] - a[2]).map(([pair]) => pair);
}

/**
 * The length of the common head and tail of `a` and `b`, a same param
 * (`mergeCapture`) counting as common.
 */
function closeness(a: Alternative, b: Alternative): number {
  const alike = (x: string, y: string) =>
    x === y || (x.startsWith("(?<") && groupNames(x)[0] === groupNames(y)[0]);
  let h = 0;
  while (h < a.length && h < b.length && alike(a[h], b[h])) h++;
  let t = 0;
  while (t < a.length - h && t < b.length - h && alike(a.at(-1 - t)!, b.at(-1 - t)!)) t++;
  return h + t;
}

function sharesName(a: Alternative, b: Alternative): boolean {
  const names = new Set(groupNames(a.join("")));
  return groupNames(b.join("")).some((name) => names.has(name));
}

/**
 * Whether no input can match both `a` and `b`, both followed by `after`
 * segments: they add different fixed numbers of segments. Lookup strips one
 * trailing slash at most, so a path has one segment count.
 */
function disjoint(a: Alternative, b: Alternative, after: number | undefined): boolean {
  const countA = segmentCount(a);
  const countB = segmentCount(b);
  return after !== undefined && countA !== undefined && countB !== undefined && countA !== countB;
}

/** Whether an item ends in a quantifier (it can match in several ways). */
function quantified(item: string): boolean {
  return !/^\\[^]$/.test(item) && /(?:[*+?]|\})\??$/.test(item);
}

/**
 * Whether an item can't match a `/`: no `/` (other than in rou3's `[^/]`
 * and in look-arounds, which match nothing), no `.`, negated class or
 * escape that takes one (conservative).
 */
function slashFree(item: string): boolean {
  let text = "";
  let skip = 0;
  for (const atom of item.match(ATOM) || []) {
    if (skip > 0 || /^\(\?<?[=!]/.test(atom)) {
      if (atom[0] === "(") skip++;
      else if (atom === ")") skip--;
    } else {
      text += atom;
    }
  }
  text = text.replaceAll("[^/]", "").replace(/\\[^\dA-Za-z/]|\\[dswbB]/g, "");
  return !/[./]|\\|\[\^/.test(text);
}

/** One item matching any of `alternatives` (in order). */
function alternation(alternatives: Alternative[]): string {
  const sources = alternatives.map((alternative) => alternative.join(""));
  const filled = sources.filter(Boolean);
  const group = `(?:${filled.join("|")})`;
  if (filled.length === sources.length) return group;
  if (sources.at(-1) === "") return `${group}?`;
  return sources[0] === "" ? `${group}??` : `(?:${sources.join("|")})`;
}

/** `pattern` as a single item when followed by more (a `|` would split it). */
function wrap(pattern: string): string {
  return splitAlternation(pattern).length > 1 ? `(?:${pattern})` : pattern;
}

/** `source` with its named groups made non-capturing. */
function unnamed(source: string): string {
  return source.replace(/\(\?<(?![=!])[^>]*>/g, "(?:");
}

function dedupe(alternatives: Alternative[]): Alternative[] {
  const seen = new Set<string>();
  return alternatives.filter((alternative) => {
    const source = alternative.join("\0");
    return !seen.has(source) && !!seen.add(source);
  });
}

/** Top-level items of a regex body: groups, classes, escapes and chars, with their quantifier. */
function splitItems(body: string): Alternative {
  const items: string[] = [];
  let depth = 0;
  for (const atom of body.match(ATOM) || []) {
    if (depth === 0 && !/^(?:[*+?]|\{\d)/.test(atom)) items.push("");
    items[items.length - 1] += atom;
    if (atom[0] === "(") depth++;
    else if (atom === ")") depth--;
  }
  return items;
}

/** The top-level alternatives of a regex body. */
function splitAlternation(body: string): string[] {
  const branches = [""];
  for (const item of splitItems(body)) {
    if (item === "|") branches.push("");
    else branches[branches.length - 1] += item;
  }
  return branches;
}
