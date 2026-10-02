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
