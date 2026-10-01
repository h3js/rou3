export interface RouterContext<T = unknown> {
  root: Node<T>;
  static: Record<string, Node<T> | undefined>;
}

/**
 * One entry per param: its route index (`-(i + 1)` for a `**` at `i`), its
 * name (`"0"`, `"1"`, … for a `*`) or segment regex, and whether it may match
 * no segment (a trailing `*`, a bare `**`).
 */
export type ParamsIndexMap = Array<[Index: number, name: string | RegExp, optional: boolean]>;
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

// `[key, unset over zero segments]` per unnamed `*` / `**` capture, keyed
// "0", "1", … left to right (segments may follow a `**`, matched from the end
// of the path)
type ExtractWildcards<
  TPath extends string,
  Count extends readonly unknown[] = [],
> = TPath extends `${string}*${infer Rest}`
  ? Rest extends `*:${infer Named}` // Named catch-all (**:name), a key of `ExtractParams`
    ? ExtractWildcards<Named, Count>
    : Rest extends `*${infer Tail}` // Double wildcard (**), `**<rest>` is `**/*<rest>` (a `}` closes a group)
      ?
          | [`${Count["length"]}`, true]
          | ExtractWildcards<
              Tail extends "" | `${"/" | "}"}${string}` ? Tail : `*${Tail}`,
              [...Count, unknown]
            >
      : [`${Count["length"]}`, false] | ExtractWildcards<Rest, [...Count, unknown]> // Single wildcard (*)
  : never; // No more wildcards found

// A trailing bare `*` segment matches zero segments too, so its capture may be
// undefined; not after a `**` (or a `:name+`, which is one), where it takes one
type ExtractTrailingWildcard<
  TPath extends string,
  TRoute extends string,
> = TRoute extends `${string}**${string}`
  ? never
  : HasRepeatParam<TRoute> extends true
    ? never
    : TPath extends `${infer Prefix}/*${"" | "/"}`
      ? Exclude<ExtractWildcards<TPath>, ExtractWildcards<Prefix>>[0]
      : never;

// A `:name+` before the last segment (not a static segment ending in `+`)
type HasRepeatParam<TRoute extends string> = TRoute extends `${string}:${infer Rest}`
  ? Rest extends `${infer Token}/${infer Tail}`
    ? Token extends `${string}+`
      ? true
      : HasRepeatParam<`/${Tail}`>
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
// group are no param)
type ExtractParams<TPath extends string> = TPath extends `${infer Pre}:${infer Rest}`
  ? Pre extends `${string}${"\\" | "(?"}`
    ? ExtractParams<Rest>
    : ParamAt<Rest, NameRun<Rest>>
  : never;

type ParamAt<Rest extends string, Name extends string> = Rest extends `${Name}${infer After}`
  ? AfterConstraint<After> extends infer Tail extends string
    ? (Name extends ValidName<Name> ? [Name, OptionalParam<Tail>] : never) | ExtractParams<Tail>
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
    ? Rest extends `${string}/${infer Tail}`
      ? `${Prefix}/${StripParams<Tail>}`
      : Prefix
    : TPath;

export type InferRouteParams<TPath extends string> = {
  [Param in ExtractParams<TPath> as Param[0]]: Param[1] extends true ? string | undefined : string;
} & {
  [Wildcard in ExtractWildcards<StripParams<TPath>> as Wildcard[0]]: Wildcard[1] extends true
    ? string | undefined
    : Wildcard[0] extends ExtractTrailingWildcard<StripParams<TPath>, TPath>
      ? string | undefined
      : string;
} & (true extends ExtractWildcards<StripParams<TPath>>[1]
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
