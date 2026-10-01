export interface RouterContext<T = unknown> {
  root: Node<T>;
  static: Record<string, Node<T> | undefined>;
}

/**
 * One entry per param: its route index (`-(i + 1)` for a catch-all at `i`),
 * its name (`"0"`, `"1"`, … for a `*` or a bare `**`) or segment regex,
 * whether it may match no segment (a bare `**`; a trailing `*` is optional
 * too, see `matchesZero`), then:
 * - a catch-all: whether one that needs a segment may capture `""` (a `*`;
 *   a `:name` / `**:name` needs a value);
 * - a segment regex: whether it restricts the segment no more than a plain
 *   `:name` / `*` (`plain`: captures alone with at most one required
 *   `:name`, `*:a`, `:a:b?`), so that the from-end ranking reads it as one
 *   (`kindAt`), and the name of its in-place optional param (`*-:x?`: `x`,
 *   unset when absent), as `getParamRegexp` built it;
 * - and whether it adds to the capture of a `*` inside a segment that an
 *   earlier piece started (see `splitStar`).
 */
export type ParamsIndexMap = Array<
  [
    Index: number,
    name: string | RegExp,
    optional: boolean,
    emptyOrPlain?: boolean,
    inPlace?: string,
    join?: boolean,
  ]
>;
export type MethodData<T = unknown> = {
  data: T;
  paramsMap?: ParamsIndexMap;
  paramsRegexp: RegExp[];
  /**
   * Registration identity shared by every entry one `addRoute` call creates;
   * `removeRoute` splices entries by it. Not the source pattern: a plain
   * pattern stores its rewritten segment join, an expanding one its
   * pre-expansion text (see `_add` in operations/add.ts).
   */
  route: string;
  /**
   * Set on routes with segments after `**`: the route index of the `**` and
   * how many segments follow it. Those segments are matched from the end of
   * the path.
   */
  suffix?: [wildcard: number, length: number];
};

export interface Node<T = unknown> {
  key: string;

  static?: Record<string, Node<T>>;
  param?: Node<T>;
  wildcard?: Node<T>;

  /**
   * On a wildcard node: the segments its routes have after `**`, stored
   * last segment first (a trie matched from the end of the path).
   */
  suffix?: Node<T>;

  /**
   * Set on every node on the way to a wildcard with a `suffix` trie, so lookup
   * can skip subtrees without one. Never cleared (a stale flag only costs a
   * lookup).
   */
  hasSuffix?: boolean;

  hasRegexParam?: boolean;

  methods?: Record<string, MethodData<T>[] | undefined>;
}

export type MatchedRoute<T = unknown> = {
  data: T;
  params?: Record<string, string>;
};

// `[key, may be unset, is a bare `**`]` per unnamed capture (`*`, `**`, an unnamed `(…)`
// group), keyed "0", "1", … left to right over the whole pattern (segments
// may follow a `**`, matched from the end of the path). A `**` may be unset
// (zero segments), and so may a whole-segment `*` ending the route (optional
// there) and any capture in an optional `{…}?` group (`Opt`). `S`: the
// previous char is a `/`. Tail-recursive (`Acc`), and plain text is skipped 8
// chars at a time, so long routes stay in TS's recursion limit.
type ExtractWildcards<
  TPath extends string,
  Count extends readonly unknown[] = [],
  Acc = never,
  Opt extends boolean = false,
  S extends boolean = false,
> = TPath extends `${infer A}${infer B}${infer C}${infer D}${infer E}${infer F}${infer G}${infer H}${infer Rest}`
  ? `${A}${B}${C}${D}${E}${F}${G}${H}` extends `${string}${"\\" | "(" | "*" | "{" | "}"}${string}`
    ? ScanWildcard<TPath, Count, Acc, Opt, S>
    : ExtractWildcards<Rest, Count, Acc, Opt, H extends "/" ? true : false>
  : ScanWildcard<TPath, Count, Acc, Opt, S>;

// `ExtractWildcards` at one char
type ScanWildcard<
  TPath extends string,
  Count extends readonly unknown[],
  Acc,
  Opt extends boolean,
  S extends boolean,
> = TPath extends `${infer C}${infer Rest}`
  ? C extends "\\" // An escaped char is a literal
    ? ExtractWildcards<Rest extends `${string}${infer R}` ? R : Rest, Count, Acc, Opt>
    : C extends "(" // An unnamed group (a constraint is stripped with its param)
      ? ExtractWildcards<
          SkipGroup<TPath>,
          [...Count, unknown],
          // A `(.*)` is a `*`: unset where it is a whole segment ending the route
          Acc | [`${Count["length"]}`, S extends true ? EndingStar<TPath, Opt> : Opt, false],
          Opt
        >
      : C extends "{" // A group: optional when `}?` closes it (groups don't nest)
        ? ExtractWildcards<
            Rest,
            Count,
            Acc,
            TPath extends `{${string}}?${string}` ? GroupOptional<TPath> : false,
            S
          >
        : C extends "}"
          ? ExtractWildcards<Rest, Count, Acc, false>
          : C extends "*"
            ? Rest extends `*:${infer Named}` // Named catch-all (**:name), a key of `ExtractParams`
              ? ExtractWildcards<Named, Count, Acc, Opt>
              : Rest extends `*${infer Tail}` // `**`
                ? ExtractWildcards<
                    Tail,
                    [...Count, unknown],
                    | Acc
                    // A bare `**` (a `{` / `}` is a group's: `**{.md}?` is `**`
                    // or `*.md`, one key), unset over zero segments; `**<rest>`
                    // reads like `*<rest>`
                    | (Tail extends "" | `${"/" | "{" | "}"}${string}`
                        ? [`${Count["length"]}`, true, true]
                        : [`${Count["length"]}`, Opt, false]),
                    Opt
                  >
                : // A `*`: set (`""` at least), unless in an optional group or a
                  // whole segment ending the route (also before a last `{…}?`)
                  ExtractWildcards<
                    Rest,
                    [...Count, unknown],
                    | Acc
                    | [
                        `${Count["length"]}`,
                        S extends true
                          ? Rest extends "" | "/" | `{${string}}?`
                            ? true
                            : Opt
                          : Opt,
                        false,
                      ],
                    Opt
                  >
            : ExtractWildcards<Rest, Count, Acc, Opt, C extends "/" ? true : false>
  : Acc;

// Whether `S`, right after a `/`, is a `(.*)` (a `*`) ending the route, also
// before a last `{…}?` (optional there): `true`, else `Otherwise`
type EndingStar<S extends string, Otherwise extends boolean> = S extends `(.*)${
  | ""
  | "/"
  | `{${string}}?`}`
  ? true
  : Otherwise;

// Whether the `{…}` group `TPath` starts with is optional (its first `}` is
// followed by `?`)
type GroupOptional<TPath extends string> = TPath extends `{${string}}${infer After}`
  ? After extends `?${string}`
    ? true
    : false
  : false;

type Digit = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9";
type Lower = "a" | "b" | "c" | "d" | "e" | "f" | "g" | "h" | "i" | "j" | "k" | "l" | "m";
type Lower2 = "n" | "o" | "p" | "q" | "r" | "s" | "t" | "u" | "v" | "w" | "x" | "y" | "z";
type WordChar = Digit | Lower | Lower2 | Uppercase<Lower | Lower2> | "_";

// The name run at the start of `S`, as `addRoute` reads it: `[\w$]*` (a `-`,
// `{` / `}` or `\` ends it; a non-ASCII char, part of it there, ends it here)
type NameRun<S extends string, Name extends string = ""> = S extends `${infer C}${infer Rest}`
  ? C extends WordChar | "$"
    ? NameRun<Rest, `${Name}${C}`>
    : Name
  : Name;

// Types don't validate routes: a name run `addRoute` rejects (not
// `[A-Za-z_]\w*`: `:0`, `:id$`) just gives no key
type ValidName<Name extends string> = Name extends "" | `${Digit}${string}` | `${string}$${string}`
  ? never
  : Name;

// `S` past the `(...)` group it starts with (escape aware)
type SkipGroup<S extends string, Depth extends unknown[] = []> = S extends `${infer C}${infer Rest}`
  ? C extends "\\"
    ? SkipGroup<Rest extends `${string}${infer R}` ? R : Rest, Depth>
    : C extends "("
      ? SkipGroup<Rest, [...Depth, C]>
      : C extends ")"
        ? Depth extends [unknown, ...infer D]
          ? D extends []
            ? Rest
            : SkipGroup<Rest, D>
          : SkipGroup<Rest, Depth>
        : SkipGroup<Rest, Depth>
  : S;

// `[name, optional]` for each `:name` (an escaped `\:` and the `:` of a `(?:`
// group are no param). `Start`: `TPath` starts a segment.
type ExtractParams<
  TPath extends string,
  Start extends boolean = true,
> = TPath extends `${infer Pre}:${infer Rest}`
  ? Pre extends `${string}${"\\" | "(?"}`
    ? ExtractParams<Rest, false>
    : ParamAt<Rest, NameRun<Rest>, Pre extends "" ? Start : Pre extends `${string}/` ? true : false>
  : never;

// `Segment`: the param starts its segment, where a `:name(.*)` (a `*` keyed
// by name) ending the route is optional like a `*`
type ParamAt<
  Rest extends string,
  Name extends string,
  Segment extends boolean,
> = Rest extends `${Name}${infer After}`
  ? AfterConstraint<After> extends infer Tail extends string
    ?
        | (Name extends ValidName<Name>
            ? [
                Name,
                OptionalParam<Tail> extends true
                  ? true
                  : Segment extends true
                    ? EndingStar<After, false>
                    : false,
              ]
            : never)
        | ExtractParams<Tail, false>
    : never
  : never;

type AfterConstraint<S extends string> = S extends `(${string}` ? SkipGroup<S> : S;

// A `?` / `*` modifier ending the segment, or the `}?` of an optional group
type OptionalParam<Tail extends string> = Tail extends
  | `${"?" | "*"}${"" | `/${string}`}`
  | `}?${string}`
  ? true
  : false;

// Remove `:name...` tokens so a modifier `*` is never counted as a wildcard capture
type StripParams<TPath extends string> = TPath extends `${infer Prefix}**:${infer Rest}`
  ? Rest extends `${infer Name}/${infer Tail}`
    ? `${StripParams<Prefix>}**:${Name}/${StripParams<Tail>}`
    : `${StripParams<Prefix>}**:${Rest}`
  : TPath extends `${infer Prefix}:${infer Rest}`
    ? Prefix extends `${string}${"\\" | "(?"}` // An escaped `\:` or a `(?:` group is no param
      ? `${Prefix}:${StripParams<Rest>}`
      : // A `:` stays, so a `*` before it isn't read as ending the route
        `${Prefix}:${StripParams<StripModifier<AfterConstraint<AfterName<Rest>>>>}`
    : TPath;

// `S` past the param name it starts with (see `NameRun`)
type AfterName<S extends string> = S extends `${NameRun<S>}${infer After}` ? After : S;

// `S` past a `?` / `+` / `*` modifier it starts with (a `*` right after a
// param is one)
type StripModifier<S extends string> = S extends `${"?" | "+" | "*"}${infer After}` ? After : S;

export type InferRouteParams<TPath extends string> = {
  [Param in ExtractParams<TPath> as Param[0]]: Param[1] extends true ? string | undefined : string;
} & {
  [Wildcard in ExtractWildcards<StripParams<TPath>> as Wildcard[0]]: Wildcard[1] extends true
    ? string | undefined
    : string;
} & (true extends ExtractWildcards<StripParams<TPath>>[2]
    ? DoubleStarAlias
    : unknown) extends infer Params
  ? { [K in keyof Params]: Params[K] }
  : never;

/** The deprecated `_` alias of a bare `**` capture. */
interface DoubleStarAlias {
  /**
   * The bare `**` capture, also under its numbered key (`"0"`, `"1"`, …).
   *
   * @deprecated Kept for 0.x compatibility: read the numbered key.
   */
  _?: string;
}
