import { toGroupName, toUnnamedGroupKey } from "./_group-names.ts";
import {
  addName,
  decodeEscapes,
  encodeLiteral,
  invalidSyntax,
  MISPLACED_MODIFIER,
  PARAM_MODIFIER,
} from "./_pattern.ts";

// The regex of a dynamic segment: as written (`getParamRegexp`, shared by
// `addRoute` and `routeToRegExp`) and the tree's linear-time form of it
// (`linearRegExp`).

/**
 * The regex of a dynamic segment (params, constraints, `*`), after its
 * modifier has been expanded and its escapes encoded (`encodeEscapes`); a `\x`
 * outside a group is a literal `x`. Throws on what has no meaning (yet) there:
 * a `:` without a valid name, an empty group or one starting with `?`, a `?` /
 * `+` / `*` modifier on anything but a whole segment's `:name` (a `?` / `+` would
 * be a raw regex quantifier, a `*` right after a name or group is ambiguous with
 * a modifier) and a mid-segment `**`. `routeToRegExp` reuses it (with its own
 * unnamed group keys), so a dynamic segment is the same regex in both.
 *
 * A `:name` here shares its segment, so it takes as little as possible
 * (`[^/]+?`, as in URLPattern: `:a-:b` on `x-y-z` is `x` and `y-z`); a `*`
 * stays greedy (URLPattern's `*` is a greedy `(.*)`). A `?` ending the
 * segment after a `:name` / `:name(…)` makes it optional in place
 * (`(?:(?<x>…))?`, unset when absent; `expandModifiers` leaves it here after
 * a capture), so the captures split the segment like URLPattern's regex. Its
 * name is the third element of the result.
 *
 * The fourth is the segment's rank among same-node siblings that tie on
 * weight (see `_selectMatcher`): 256 per literal char (as encoded), plus one
 * per constraint that can't match `""`, minus one per capture that can (a
 * `*`, an optional `:name?`, a constraint like `(\d*)`). Per capture, these
 * order what it takes: a constraint ⊆ a `:name` ⊆ a capture that may be `""`.
 */
export function getParamRegexp(
  segment: string,
  unnamedStart: number,
  names: string[],
  input: string,
  groupKey: (index: number) => string = toUnnamedGroupKey,
): [RegExp, number, string | undefined, number] {
  let _i = unnamedStart;
  // The in-place optional param's name
  let _o: string | undefined;
  // Replace \x escapes outside (...) with a \uFFFE placeholder
  let _s = "",
    _d = 0,
    // Index right after the last `:name`, top-level group or `*`
    _e = -1,
    // Where the top-level group starts, the rank (see above)
    _g = 0,
    _r = 0;
  // The constraints
  const _c: string[] = [];
  for (let j = 0; j < segment.length; j++) {
    const c = segment.charCodeAt(j);
    if (_d === 0) {
      // Before a `(.*)` group's `*` that follows a name, group or `*`: no
      // modifier, nor a name's constraint (see `starGroups`); dropped below
      if (c === 0xffff) {
        _s += "\uFFFF";
        continue;
      }
      if (c === 58 /* : */) {
        // A name is `[A-Za-z_]\w*` (a `-` ends it); a `$` or non-ASCII char
        // can't follow it (part of the name in URLPattern: `:id$` is `id$`)
        _e =
          j + 1 + addName(names, /^[\w$\x80-\ufffc]*/.exec(segment.slice(j + 1))![0], input).length;
      } else if (c === 40 /* ( */ && /[?)]/.test(segment[j + 1])) {
        invalidSyntax("empty or `(?` group", input);
      } else if (c === 63 /* ? */ || c === 43 /* + */ || (c === 42 /* * */ && j === _e)) {
        // A `?` ending the segment after a `:name` / `:name(…)` makes it
        // optional: kept raw for the name replace below (literal text is
        // percent-encoded, it would be `%3F`)
        if (c === 63 && j === segment.length - 1 && PARAM_MODIFIER.test(segment)) {
          _s += "?";
          _r--;
          continue;
        }
        // Otherwise `?` / `+` here would be raw quantifiers; a `*` right after
        // a name or group is ambiguous with a modifier, after a `*` a
        // mid-segment `**` (an escaped `\*` is consumed below and never sets
        // `_e`)
        invalidSyntax(MISPLACED_MODIFIER, input);
      } else if (c === 42) {
        // A `*` here is the part of a catch-all in this segment (see
        // `splitStar`), an unnamed group numbered with the others
        _e = j + 1;
        _s += "([^/]*)";
        _r--;
        continue;
      }
    } else if (c === 58) {
      // A `:` inside a group (`(?:`) is no param
      _s += "\uFFFE:";
      continue;
    }
    if (c === 40) {
      if (_d++ === 0) _g = j;
    } else if (c === 41 && _d > 0) {
      if (--_d === 0) {
        _e = j + 1;
        // A constraint (not `joinGroup`'s `:name`)
        const p = segment.slice(_g + 1, j);
        if (p !== "[^\\x2f]+?") _c.push(p);
      }
    } else if (_d === 0 && c === 0xfffd && /[34]/.test(segment[j + 1])) {
      // `encodeEscapes`' placeholders 3 and 4, an escaped `{` / `}`, are text;
      // the others (`\:` `\(` `\)` `\\`) stay hidden until params and groups
      // are named (`encodeLiteral` leaves U+FFFD alone)
      _s += encodeLiteral("{}"[+segment[++j] - 3]);
      _r += 768;
      continue;
    } else if (_d === 0 && /[\0- "#$).<>?[-^`{-}\x7F-\uFFFC]/.test(segment[j])) {
      // Outside a (...) group, a `\x` is a literal `x` (U+FFFE-marked; `\*`
      // stays an escape so it is no wildcard), and so are regex chars, as in
      // a static segment (`:x.json`, `*$`; inside a group they are regex:
      // `:id(\d+\.\d+)`). Literal text is percent-encoded like URLPattern
      // (`encodeLiteral`, a surrogate pair at once; `%XX` is no syntax).
      const esc = c === 92 && j + 1 < segment.length ? 1 : 0;
      const ch = segment.slice(j + esc, j + esc + (segment.codePointAt(j + esc)! > 0xffff ? 2 : 1));
      const encoded = encodeLiteral(ch);
      j += esc + ch.length - 1;
      _s += encoded !== ch ? encoded : esc && ch !== "*" ? "\uFFFE" + ch : "\\" + ch;
      _r += encoded.length * 256;
      continue;
    }
    // Text outside groups and names (an escape placeholder is one char)
    if (_d === 0 && j >= _e && segment.charCodeAt(j - 1) !== 0xfffd) _r += 256;
    _s += segment[j];
  }
  const regex = decodeEscapes(
    _s
      // Names were checked and recorded above; a `\uFFFE:` is inside a group.
      // `[^\x2f]+?` before a group is the `:name` `joinGroup` constrained,
      // emitted as `[^/]+?` (alone it stays as written).
      .replace(/(?<!\uFFFE):([A-Za-z_]\w*)(?:\(([^)]*)\))?(\?$)?/g, (m, id, p, o, i, s) => {
        const group = `(?<${toGroupName(id)}>${p && (p != "[^\\x2f]+?" || !/[(\uFFFF]/.test(s[i + m.length])) ? p : "[^/]+?"})`;
        return o ? ((_o = id), `(?:${group})?`) : group;
      })
      .replace(/\((?![?<])/g, () => `(?<${groupKey(_i++)}>`),
    "\uFFFE",
  ).replace(/\uFFFE([\s\S])|\uFFFF/g, (_, c = "") => (/[.*+?^${}()|[\]\\]/.test(c) ? `\\${c}` : c));

  const regexp = new RegExp(`^${regex}$`);
  for (const p of _c) {
    _r += new RegExp(`^(?:${decodeEscapes(p, "\\")})$`).test("") ? -1 : 1;
  }
  return [regexp, _i, _o, _r];
}

/**
 * The tree's form of a dynamic segment's regex (`getParamRegexp`): the same
 * matches and captures, without the polynomial backtracking of several
 * captures in one segment (`:year-:month-:day.html` on a long run of `-`
 * tried every split: cubic). Only rou3's own pieces are rewritten (`[^/]`
 * can't be in a constraint); a constraint stays as written.
 *
 * - A lazy `:name` (`[^/]+?`) followed by text `L` and then a `:name`, a `*`
 *   or a last `:name?` takes up to the first `L` (`[^/][^/L]*`, or a tempered
 *   `(?:(?!L)[^/])*` for longer text), and one followed by such a capture
 *   directly takes one char: the capture after it takes any value, so if a
 *   longer value let the rest match, the shortest does too (what `+?` picks).
 * - A `*` (`[^/]*`) followed only by text and such params ends where they
 *   start latest: matched once from the end of the segment in a look-behind
 *   (each param as short as it can be, the text before it the last one), as
 *   group 1, and the greedy `*` must leave exactly that (`(?=\1$)`; a longer
 *   rest is never tried, a shorter one fails `\1`'s length check at once).
 *
 * Each param then reads its text once, linear in the segment, but after a
 * constraint, which may still backtrack over what follows it. `routeToRegExp`
 * keeps `getParamRegexp`'s form (no look-around, any engine).
 */
export function linearRegExp(regexp: RegExp): RegExp {
  let source = regexp.source;
  // Only a lazy `:name` can take its text in more than one way
  if (!source.includes("[^/]+?)")) return regexp;
  let head = "";
  // `L`: a literal run (`\x` or a plain char); then `(?<n>[^/]+?)` or a last
  // `(?:(?<n>[^/]+?))?`
  source = source.replace(
    /(\(\?<\w+>\[\^\/\]\*\))((?:\\[\s\S]|[^\\()]|(?:\(\?:)?\(\?<\w+>\[\^\/\]\+\?\)(?:\)\?)?)*)\$$/,
    (all, star: string, rest: string) => {
      // Text alone after the `*` backtracks one char at a time already
      if (!rest.includes("+?")) return all;
      head = `(?=[^/]*$(?<=(${rest.replace(
        /((?:\\[\s\S]|[^\\()])+)(?=\()|(\(\?:)?\(\?<\w+>\[\^\/\]\+\?\)(?:\)\?)?/g,
        (_, L?: string, opt?: string) => (L ? L + upTo(L, true) : opt ? "" : "[^/]"),
      )})))`;
      return `${star}(?=\\1$)${rest}$`;
    },
  );
  source = source.replace(
    /\[\^\/\]\+\?\)((?:\\[\s\S]|[^\\()])*)(?=(?:\(\?:)?\(\?<\w+>\[\^\/\](?:\+\?|\*)\))/g,
    (_, L: string) => `[^/]${L && upTo(L)})${L}`,
  );
  return source === regexp.source ? regexp : new RegExp(`^${head}${source.slice(1)}`);
}

// A param's chars up to text `L` (`back`: in a look-behind)
const upTo = (L: string, back?: boolean) =>
  L.replace(/^\\/, "").length < 2 ? `[^/${L}]*` : back ? `(?:[^/](?<!${L}))*` : `(?:(?!${L})[^/])*`;
