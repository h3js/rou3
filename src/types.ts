export interface RouterContext<T = unknown> {
  root: Node<T>;
  static: Record<string, Node<T> | undefined>;
}

export type ParamsIndexMap = Array<
  [Index: number, name: string | RegExp, optional: boolean]
>;
export type MethodData<T = unknown> = {
  data: T;
  paramsMap?: ParamsIndexMap;
  paramsRegexp: RegExp[];
};

export interface Node<T = unknown> {
  key: string;

  static?: Record<string, Node<T>>;
  param?: Node<T>;
  wildcard?: Node<T>;

  hasRegexParam?: boolean;

  methods?: Record<string, MethodData<T>[] | undefined>;
}

export type MatchedRoute<T = unknown> = {
  data: T;
  params?: Record<string, string>;
};

type ExtractWildcards<
  TPath extends string,
  Count extends readonly unknown[] = [],
> = TPath extends `${string}**:${infer Rest}` // Named catch-all wildcard (**:name)
  ? Rest extends `${infer Param}/${infer Tail}`
    ? Param | ExtractWildcards<Tail, Count>
    : Rest
  : TPath extends `${string}*${infer Rest}` // Wildcard patterns
    ? Rest extends `*` // Double wildcard (**) -> "_"
      ? `_`
      : `${Count["length"]}` | ExtractWildcards<Rest, [...Count, unknown]> // Single wildcard (*) -> "0", "1", etc.
    : TPath extends `${string}/${infer Rest}` // Continue parsing path segments
      ? ExtractWildcards<Rest, Count>
      : never; // No more wildcards found

type ExtractNamedParams<TPath extends string> =
  TPath extends `${infer _Start}:${infer Rest}` // Found named parameter (:name)
    ? Rest extends `${infer Param}/${infer Tail}` // Parameter followed by path
      ? Param | ExtractNamedParams<`/${Tail}`>
      : Rest extends `${infer Param}*${infer Tail}` // Parameter followed by wildcard
        ? Param | ExtractNamedParams<`/${Tail}`>
        : Rest // Final parameter
    : TPath extends `/${infer Rest}` // Continue parsing path
      ? ExtractNamedParams<Rest>
      : never; // No parameters found

export type InferRouteParams<TPath extends string> = {
  [K in ExtractNamedParams<TPath> | ExtractWildcards<TPath>]: string;
};
