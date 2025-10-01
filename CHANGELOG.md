# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

## v0.7.7

[compare changes](https://github.com/h3js/rou3/compare/v0.7.6...v0.7.7)

### 🩹 Fixes

- **addRoute:** Always normalize path and method ([844776f](https://github.com/h3js/rou3/commit/844776f))

### ❤️ Contributors

- Pooya Parsa ([@pi0](https://github.com/pi0))

## v0.7.6

[compare changes](https://github.com/h3js/rou3/compare/v0.7.5...v0.7.6)

### 🚀 Enhancements

- **types:** Add `InferRouteParams` for param extraction ([#168](https://github.com/h3js/rou3/pull/168))

### 🔥 Performance

- **compiler:** Short circuit when no routes exist ([ef3c444](https://github.com/h3js/rou3/commit/ef3c444))

### 💅 Refactors

- **compiler:** Simplify logic ([082f20f](https://github.com/h3js/rou3/commit/082f20f))

### 🏡 Chore

- Update deps ([7571e28](https://github.com/h3js/rou3/commit/7571e28))

### ❤️ Contributors

- Pooya Parsa ([@pi0](https://github.com/pi0))
- Lucas Nørgård ([@luxass](https://github.com/luxass))

## v0.7.5

[compare changes](https://github.com/h3js/rou3/compare/v0.7.4...v0.7.5)

### 🚀 Enhancements

- **compiler:** Support custom data `serialize` option ([c633ed1](https://github.com/h3js/rou3/commit/c633ed1))

### 🏡 Chore

- Apply automated updates ([e459e5b](https://github.com/h3js/rou3/commit/e459e5b))

### ❤️ Contributors

- Pooya Parsa ([@pi0](https://github.com/pi0))

## v0.7.4

[compare changes](https://github.com/h3js/rou3/compare/v0.7.3...v0.7.4)

### 🩹 Fixes

- **compiler:** Add missing return statement for matchAll ([0e02b36](https://github.com/h3js/rou3/commit/0e02b36))

### 🏡 Chore

- Update deps ([7880055](https://github.com/h3js/rou3/commit/7880055))

### ❤️ Contributors

- Pooya Parsa ([@pi0](https://github.com/pi0))

## v0.7.3

[compare changes](https://github.com/h3js/rou3/compare/v0.7.2...v0.7.3)

### 🚀 Enhancements

- **compiler:** Support `matchAll` mode ([#165](https://github.com/h3js/rou3/pull/165))

### 🔥 Performance

- **compiler:** Avoid array slicing ([#164](https://github.com/h3js/rou3/pull/164))

### ❤️ Contributors

- Pooya Parsa ([@pi0](https://github.com/pi0))

## v0.7.2

[compare changes](https://github.com/h3js/rou3/compare/v0.7.1...v0.7.2)

### 🩹 Fixes

- **routeToRegExp:** Match wildcard without trailing slashes as well ([f0361df](https://github.com/h3js/rou3/commit/f0361df))
- **routeToRegExp:** Keep wildcard as `_` ([205430d](https://github.com/h3js/rou3/commit/205430d))
- **routeToRegExp:** Support named wildcard ([5d0c8f5](https://github.com/h3js/rou3/commit/5d0c8f5))
- **routeToRegExp:** Preserve anonymous counter ids ([5682d66](https://github.com/h3js/rou3/commit/5682d66))

### 🏡 Chore

- Rename `_utils.ts` to `object.ts` ([0f72045](https://github.com/h3js/rou3/commit/0f72045))

### ✅ Tests

- Update regexp tests ([e848ec7](https://github.com/h3js/rou3/commit/e848ec7))

### ❤️ Contributors

- Pooya Parsa ([@pi0](https://github.com/pi0))

## v0.7.1

[compare changes](https://github.com/h3js/rou3/compare/v0.7.0...v0.7.1)

### 🔥 Performance

- **compiler:** Treeshake empty conditions ([#162](https://github.com/h3js/rou3/pull/162))

### 🏡 Chore

- **release:** V0.7.0 ([d714798](https://github.com/h3js/rou3/commit/d714798))

### ❤️ Contributors

- Pooya Parsa ([@pi0](https://github.com/pi0))
- Vlad Sirenko ([@sirenkovladd](https://github.com/sirenkovladd))

## v0.7.0

[compare changes](https://github.com/h3js/rou3/compare/v0.6.3...v0.7.0)

### 🚀 Enhancements

- Experimental compiler ([#155](https://github.com/h3js/rou3/pull/155))
- **compiler:** Complete functionality to match `findRoute` ([#158](https://github.com/h3js/rou3/pull/158))
- **compiler:** `compileRouterToString` ([#159](https://github.com/h3js/rou3/pull/159))
- **compileRouterToString:** Support serializing custom code with `{ toJSON }` ([064ae0d](https://github.com/h3js/rou3/commit/064ae0d))

### 🔥 Performance

- **compiler:** Faster split ([8b2ea34](https://github.com/h3js/rou3/commit/8b2ea34))

### 🩹 Fixes

- **compiler:** Avoid duplicate static checks ([db9fcf2](https://github.com/h3js/rou3/commit/db9fcf2))
- Preserve empty segments ([#160](https://github.com/h3js/rou3/pull/160))

### 💅 Refactors

- **compiler:** Only warn for not supported regexp ([012d8b9](https://github.com/h3js/rou3/commit/012d8b9))

### 📦 Build

- Use `/compiler` subpath ([8c8c12e](https://github.com/h3js/rou3/commit/8c8c12e))

### 🏡 Chore

- Apply automated updates ([3c7526d](https://github.com/h3js/rou3/commit/3c7526d))
- Add codeowners file ([3693344](https://github.com/h3js/rou3/commit/3693344))
- Update deps ([ba1eba0](https://github.com/h3js/rou3/commit/ba1eba0))
- Remove duplicate test ([e370538](https://github.com/h3js/rou3/commit/e370538))
- Refactor compiler fns ([ed4a95d](https://github.com/h3js/rou3/commit/ed4a95d))
- Update jsdocs ([65bc888](https://github.com/h3js/rou3/commit/65bc888))
- Typo ([302ef03](https://github.com/h3js/rou3/commit/302ef03))
- Apply automated updates ([c22b957](https://github.com/h3js/rou3/commit/c22b957))

### ✅ Tests

- Add `test:compiler` for full tests ([636795f](https://github.com/h3js/rou3/commit/636795f))
- Snapshot compiler result ([991e7d8](https://github.com/h3js/rou3/commit/991e7d8))
- Merge compiler with main tests ([e5c7b50](https://github.com/h3js/rou3/commit/e5c7b50))
- Add back compiler snapshot! ([e4d6287](https://github.com/h3js/rou3/commit/e4d6287))
- Make sure all inputs have leading slash ([0aa1de3](https://github.com/h3js/rou3/commit/0aa1de3))

### ❤️ Contributors

- Pooya Parsa ([@pi0](https://github.com/pi0))
- Reve ([@aquapi](https://github.com/aquapi))

## v0.6.3

[compare changes](https://github.com/h3js/rou3/compare/v0.6.2...v0.6.3)

### 📦 Build

- Export `NullProtoObj` ([4cf5502](https://github.com/h3js/rou3/commit/4cf5502))

### ❤️ Contributors

- Pooya Parsa ([@pi0](https://github.com/pi0))

## v0.6.2

[compare changes](https://github.com/h3js/rou3/compare/v0.6.1...v0.6.2)

### 🚀 Enhancements

- `routeToRegExp` util ([#153](https://github.com/h3js/rou3/pull/153))

### 📦 Build

- Export `MatchedRoute` type ([#152](https://github.com/h3js/rou3/pull/152))

### 🏡 Chore

- Update obuild ([4c39178](https://github.com/h3js/rou3/commit/4c39178))
- Move to h3js ([f0dc20a](https://github.com/h3js/rou3/commit/f0dc20a))
- Update readme for cdn usage ([#151](https://github.com/h3js/rou3/pull/151))
- Apply automated updates ([1f8fcb7](https://github.com/h3js/rou3/commit/1f8fcb7))
- Update deps ([df16f13](https://github.com/h3js/rou3/commit/df16f13))

### ❤️ Contributors

- Pooya Parsa ([@pi0](https://github.com/pi0))
- Wind <hi@productdevbook.com>
- Huseeiin ([@huseeiin](https://github.com/huseeiin))

## v0.6.1

[compare changes](https://github.com/h3js/rou3/compare/v0.6.0...v0.6.1)

### 💅 Refactors

- Explicit extensions and types ([2043cca](https://github.com/h3js/rou3/commit/2043cca))

### 📦 Build

- Use obuild ([e209f3b](https://github.com/h3js/rou3/commit/e209f3b))

### 🏡 Chore

- Update readme ([6cf82d7](https://github.com/h3js/rou3/commit/6cf82d7))

### ❤️ Contributors

- Pooya Parsa ([@pi0](https://github.com/pi0))

## v0.6.0

[compare changes](https://github.com/h3js/rou3/compare/v0.5.1...v0.6.0)

### 🩹 Fixes

- **findAll:** Last named segment is required ([#128](https://github.com/h3js/rou3/pull/128))
- **removeRoute:** Remove named wildcard routes ([#137](https://github.com/h3js/rou3/pull/137))

### 💅 Refactors

- Improve null proto obj ([5899c44](https://github.com/h3js/rou3/commit/5899c44))

### 📦 Build

- ⚠️ Esm-only dist ([c7d3025](https://github.com/h3js/rou3/commit/c7d3025))

### 🏡 Chore

- Update deps ([9a60d24](https://github.com/h3js/rou3/commit/9a60d24))
- Apply automated updates ([8cfb1bf](https://github.com/h3js/rou3/commit/8cfb1bf))
- Update dev deps ([cbf4a8a](https://github.com/h3js/rou3/commit/cbf4a8a))

#### ⚠️ Breaking Changes

- ⚠️ Esm-only dist ([c7d3025](https://github.com/h3js/rou3/commit/c7d3025))

### ❤️ Contributors

- Pooya Parsa ([@pi0](https://github.com/pi0))
- Vlad Sirenko ([@sirenkovladd](https://github.com/sirenkovladd))
- Estéban ([@Barbapapazes](https://github.com/Barbapapazes))

## v0.5.1

[compare changes](https://github.com/h3js/rou3/compare/v0.5.0...v0.5.1)

### 💅 Refactors

- Reduce bundle overhead ([0eed2e8](https://github.com/h3js/rou3/commit/0eed2e8))

### ❤️ Contributors

- Pooya Parsa ([@pi0](http://github.com/pi0))

## v0.5.0

[compare changes](https://github.com/h3js/rou3/compare/v0.4.0...v0.5.0)

### 🔥 Performance

- Avoid `Object.create(null)` ([2b7ac09](https://github.com/h3js/rou3/commit/2b7ac09))

### 🩹 Fixes

- ⚠️ Last named segment should be required ([#123](https://github.com/h3js/rou3/pull/123))

### 🏡 Chore

- Ignore bun lockfile ([172f548](https://github.com/h3js/rou3/commit/172f548))
- Update release ([1c85bb8](https://github.com/h3js/rou3/commit/1c85bb8))

#### ⚠️ Breaking Changes

- ⚠️ Last named segment should be required ([#123](https://github.com/h3js/rou3/pull/123))

### ❤️ Contributors

- Pooya Parsa ([@pi0](http://github.com/pi0))

## v0.4.0

[compare changes](https://github.com/h3js/rou3/compare/v0.3.0...v0.4.0)

### 🚀 Enhancements

- ⚠️ Support multiple entries with same route ([#118](https://github.com/h3js/rou3/pull/118))

### 🏡 Chore

- Update bench ([a293f3b](https://github.com/h3js/rou3/commit/a293f3b))
- Update docs ([484a77e](https://github.com/h3js/rou3/commit/484a77e))

#### ⚠️ Breaking Changes

- ⚠️ Support multiple entries with same route ([#118](https://github.com/h3js/rou3/pull/118))

### ❤️ Contributors

- Pooya Parsa ([@pi0](http://github.com/pi0))

## v0.3.0

[compare changes](https://github.com/h3js/rou3/compare/v0.1.0...v0.3.0)

### 🚀 Enhancements

- ⚠️ `findAllRoutes` ([#117](https://github.com/h3js/rou3/pull/117))

### 🩹 Fixes

- **matcher:** Match param in last segment ([#110](https://github.com/h3js/rou3/pull/110))

### 💅 Refactors

- ⚠️ Unify apis with `method, path` order ([#114](https://github.com/h3js/rou3/pull/114))
- **matcher:** Improve readability ([af7af4d](https://github.com/h3js/rou3/commit/af7af4d))
- Makes params matching opt-out always ([35aaf15](https://github.com/h3js/rou3/commit/35aaf15))

### 🏡 Chore

- Fix coverage report ([4aad1cb](https://github.com/h3js/rou3/commit/4aad1cb))
- More strict tsconfig ([164efa2](https://github.com/h3js/rou3/commit/164efa2))
- Add bundle size badge ([a540ceb](https://github.com/h3js/rou3/commit/a540ceb))
- **release:** V0.2.0 ([6bde127](https://github.com/h3js/rou3/commit/6bde127))
- Reset changelog for rou3 ([b7fe8b7](https://github.com/h3js/rou3/commit/b7fe8b7))
- Update bench test ([d5574a5](https://github.com/h3js/rou3/commit/d5574a5))
- Update tests and bench ([aa2153f](https://github.com/h3js/rou3/commit/aa2153f))
- Bench against source ([05b9a8b](https://github.com/h3js/rou3/commit/05b9a8b))
- Update bench ([70dc811](https://github.com/h3js/rou3/commit/70dc811))

### ✅ Tests

- Update matcher tests ([c81d596](https://github.com/h3js/rou3/commit/c81d596))
- Add benchmark tests ([#116](https://github.com/h3js/rou3/pull/116))

#### ⚠️ Breaking Changes

- ⚠️ `findAllRoutes` ([#117](https://github.com/h3js/rou3/pull/117))
- ⚠️ Unify apis with `method, path` order ([#114](https://github.com/h3js/rou3/pull/114))

### ❤️ Contributors

- Pooya Parsa ([@pi0](http://github.com/pi0))

## v0.2.0

[compare changes](https://github.com/h3js/rou3/compare/v0.1.0...v0.2.0)

### 🩹 Fixes

- **matcher:** Match param in last segment ([#110](https://github.com/h3js/rou3/pull/110))

### 💅 Refactors

- ⚠️ Unify apis with `(method, path)` order ([#114](https://github.com/h3js/rou3/pull/114))
- **matcher:** Improve readability ([af7af4d](https://github.com/h3js/rou3/commit/af7af4d))

### 🏡 Chore

- Fix coverage report ([4aad1cb](https://github.com/h3js/rou3/commit/4aad1cb))
- More strict tsconfig ([164efa2](https://github.com/h3js/rou3/commit/164efa2))chor
- Add bundle size badge ([a540ceb](https://github.com/h3js/rou3/commit/a540ceb))

### ✅ Tests

- Update matcher tests ([c81d596](https://github.com/h3js/rou3/commit/c81d596))

#### ⚠️ Breaking Changes

- ⚠️ Unify apis with `method, path` order ([#114](https://github.com/h3js/rou3/pull/114))

### ❤️ Contributors

- Pooya Parsa ([@pi0](http://github.com/pi0))

## v0.1.0

Radix3 migrated to `rou3` (see https://github.com/h3js/rou3/issues/108)
