import { describe, it, expect } from 'vitest'
import { createRouter } from '../src'

export function createRoutes (paths) {
  return Object.fromEntries(paths.map(path => [path, { path }]))
}

function testRouter (paths, tests?) {
  const routes = createRoutes(paths)
  const router = createRouter({ routes })

  if (!tests) {
    tests = routes
  }

  for (const path in tests) {
    it(`lookup ${path} should be ${JSON.stringify(tests[path])}`, () => {
      expect(router.lookup(path)).to.deep.equal(tests[path])
    })
  }
}

describe('Router lookup', function () {
  describe('static routes', function () {
    testRouter([
      '/',
      '/route',
      '/another-router',
      '/this/is/yet/another/route'
    ])
  })

  describe('retrieve placeholders', function () {
    testRouter([
      'carbon/:element',
      'carbon/:element/test/:testing',
      'this/:route/has/:cool/stuff'
    ], {
      'carbon/test1': {
        path: 'carbon/:element',
        params: {
          element: 'test1'
        }
      },
      '/carbon': null,
      // TODO
      // 'carbon/': null,
      'carbon/test2/test/test23': {
        path: 'carbon/:element/test/:testing',
        params: {
          element: 'test2',
          testing: 'test23'
        }
      },
      'this/test/has/more/stuff': {
        path: 'this/:route/has/:cool/stuff',
        params: {
          route: 'test',
          cool: 'more'
        }
      }
    })
  })

  describe('should be able to perform wildcard lookups', function () {
    testRouter([
      'polymer/**:id',
      'polymer/another/route',
      'route/:p1/something/**:rest'
    ], {
      'polymer/another/route': { path: 'polymer/another/route' },
      'polymer/anon': { path: 'polymer/**:id', params: { id: 'anon' } },
      'polymer/foo/bar/baz': { path: 'polymer/**:id', params: { id: 'foo/bar/baz' } },
      'route/param1/something/c/d': { path: 'route/:p1/something/**:rest', params: { p1: 'param1', rest: 'c/d' } }
    })
  })

  describe('unnamed placeholders', function () {
    testRouter([
      'polymer/**',
      'polymer/route/*'
    ], {
      'polymer/foo/bar': { path: 'polymer/**', params: { _: 'foo/bar' } },
      'polymer/route/anon': { path: 'polymer/route/*', params: { _0: 'anon' } },
      'polymer/constructor': { path: 'polymer/**', params: { _: 'constructor' } }
    })
  })

  describe('should be able to match routes with trailing slash', function () {
    testRouter([
      'route/without/trailing/slash',
      'route/with/trailing/slash/'
    ], {
      'route/without/trailing/slash': { path: 'route/without/trailing/slash' },
      'route/with/trailing/slash/': { path: 'route/with/trailing/slash/' }
      // TODO
      // 'route/without/trailing/slash/': { path: 'route/without/trailing/slash' },
      // 'route/with/trailing/slash': { path: 'route/with/trailing/slash/' },
    })
  })
})

describe('Router startsWith', function () {
  it('should be able retrieve all results via prefix', function () {
    const router = createRouter({
      routes: createRoutes([
        'hello',
        'hi',
        'helium',
        'chrome',
        'choot',
        'chromium'
      ])
    })

    const testLookupAll = (prefix, pathsToMatch) => {
      const matches = router.lookupAll(prefix)
      for (const p of pathsToMatch) {
        expect(matches.find(m => m.path === p)).to.not.equal(undefined)
      }
    }

    testLookupAll('h', ['hello', 'hi', 'helium'])
    testLookupAll('c', ['chrome', 'choot', 'chromium'])
  })
})
