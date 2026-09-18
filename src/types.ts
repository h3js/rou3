export interface RouterContext<T = unknown> {
  root: Node<T>;
  static: Record<string, Node<T> | undefined>;
}

export type ParamsIndexMap = Array<[Index: number, name: string | RegExp, optional: boolean]>;
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
> = TPath extends `${infer Prefix}**:${infer Name}` // Named catch-all wildcard (**:name), terminal
  ? Name | ExtractWildcards<Prefix, Count>
  : TPath extends `${infer Prefix}**${string}` // Double wildcard (**) -> "_", terminal
    ? "_" | ExtractWildcards<Prefix, Count>
    : TPath extends `${string}*${infer Rest}` // Single wildcard (*) -> "0", "1", etc.
      ? `${Count["length"]}` | ExtractWildcards<Rest, [...Count, unknown]>
      : never; // No more wildcards found

// A trailing bare `*` segment matches zero segments too, so its capture may be undefined
type ExtractTrailingWildcard<TPath extends string> = TPath extends `${infer Prefix}/*${"" | "/"}`
  ? Exclude<ExtractWildcards<TPath>, ExtractWildcards<Prefix>>
  : never;

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
type StripParams<TPath extends string> = TPath extends `${infer Prefix}**:${infer Name}`
  ? `${StripParams<Prefix>}**:${Name}`
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
    StripParams<TPath>
  >
    ? string | undefined
    : string;
} extends infer Params
  ? { [K in keyof Params]: Params[K] }
  : never;
