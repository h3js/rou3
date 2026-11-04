import type { Node } from "./types.ts";

/** All fields are set so nodes keep one hidden class. */
export function createNode<T>(key: string): Node<T> {
  return {
    key,
    static: undefined,
    param: undefined,
    wildcard: undefined,
    suffix: undefined,
    hasSuffix: undefined,
    hasRegexParam: undefined,
    methods: undefined,
  };
}
