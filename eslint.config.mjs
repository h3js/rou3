import unjs from "eslint-config-unjs";

// https://github.com/unjs/eslint-config
export default unjs({
  ignores: [],
  rules: {
    "unicorn/no-null": 0,
    "@typescript-eslint/no-non-null-assertion": 0,
    "unicorn/prevent-abbreviations": 0,
    "no-unused-expressions": 0,
    "unicorn/no-for-loop": 0,
    "unicorn/prefer-regexp-test": 0,
    "unicorn/no-array-callback-reference": 0,
    "unicorn/no-array-method-this-argument": 0,
  },
});
