# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

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
