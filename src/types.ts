export interface RouterContext<T = unknown> {
  root: Node<T>;
  static: Record<string, Node<T> | undefined>;
}

export type ParamsIndexMap = Array<
  [Index: number, name: string | RegExp, optional: boolean]
>;
export type MethodData<T = unknown> = { data: T; paramsMap?: ParamsIndexMap };

export interface Node<T = unknown> {
  key: string;
  static?: Record<string, Node<T>>;
  param?: Node<T>;
  wildcard?: Node<T>;
  methods?: Record<string, MethodData<T>[] | undefined>;
}

export type MatchedRoute<T = unknown> = {
  data: T;
  params?: Record<string, string>;
};
