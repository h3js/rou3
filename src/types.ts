export interface RouterContext<T = unknown> {
  root: Node<T>;
  static: Record<string, Node<T> | undefined>;
}

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

// Left to right: segments may follow a `**` (matched from the end of the path)
type ExtractWildcards<
  TPath extends string,
  Count extends readonly unknown[] = [],
> = TPath extends `${string}*${infer Rest}`
  ? Rest extends `*:${infer Named}` // Named catch-all wildcard (**:name)
    ? Named extends `${infer Name}/${infer Tail}`
      ? Name | ExtractWildcards<Tail, Count>
      : Named
    : Rest extends `*${infer Tail}` // Double wildcard (**) -> "_", `**<rest>` is `**/*<rest>` (a `}` closes a group)
      ? "_" | ExtractWildcards<Tail extends "" | `${"/" | "}"}${string}` ? Tail : `*${Tail}`, Count>
      : `${Count["length"]}` | ExtractWildcards<Rest, [...Count, unknown]> // Single wildcard (*) -> "0", "1", etc.
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
      ? Exclude<ExtractWildcards<TPath>, ExtractWildcards<Prefix>>
      : never;

// A `:name+` before the last segment (not a static segment ending in `+`)
type HasRepeatParam<TRoute extends string> = TRoute extends `${string}:${infer Rest}`
  ? Rest extends `${infer Token}/${infer Tail}`
    ? Token extends `${string}+`
      ? true
      : HasRepeatParam<`/${Tail}`>
    : false
  : false;

// Raw `:name(constraint)?` tokens (everything after `:` up to the next `/`)
type ExtractParamTokens<TPath extends string> = TPath extends `${string}:${infer Rest}`
  ? Rest extends `${infer Token}/${infer Tail}`
    ? Token | ExtractParamTokens<`/${Tail}`>
    : Rest
  : never;

type ParamName<Token extends string> = Token extends `${infer Name}(${string}` // Regex constraint
  ? Name
  : Token extends `${infer Name}${"?" | "*" | "+"}` // Modifier
    ? Name
    : Token;

type OptionalParam<Token extends string> = Token extends `${string}${"?" | "*"}` ? true : false;

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
  [Token in ExtractParamTokens<TPath> as ParamName<Token>]: OptionalParam<Token> extends true
    ? string | undefined
    : string;
} & {
  [Key in ExtractWildcards<StripParams<TPath>>]: Key extends ExtractTrailingWildcard<
    StripParams<TPath>,
    TPath
  >
    ? string | undefined
    : string;
} extends infer Params
  ? { [K in keyof Params]: Params[K] }
  : never;
