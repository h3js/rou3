const findRoute = (m, p) => {
  if (p[p.length - 1] === "/") p = p.slice(0, -1) || "/";
  if (p === "/test") {
    if (m === "GET") return { data: { path: "/test" } };
  }
  if (p === "/test/foo") {
    if (m === "GET") return { data: { path: "/test/foo" } };
  }
  if (p === "/test/foo/bar/qux") {
    if (m === "GET") return { data: { path: "/test/foo/bar/qux" } };
  }
  if (p === "/test/foo/baz") {
    if (m === "GET") return { data: { path: "/test/foo/baz" } };
  }
  if (p === "/test/fooo") {
    if (m === "GET") return { data: { path: "/test/fooo" } };
  }
  if (p === "/another/path") {
    if (m === "GET") return { data: { path: "/another/path" } };
  }
  let [_, ...s] = p.split("/"),
    l = s.length;
  if (s[0] === "test") {
    if (s[1] === "foo") {
      if (s[2] === "bar") {
        if (s[3] === "qux") {
        }
      }
      if (s[2] === "baz") {
      }
      if (l === 3 || l === 2) {
        if (m === "GET")
          return { data: { path: "/test/foo/*" }, params: { _0: s[2] } };
      }
      if (m === "GET")
        return {
          data: { path: "/test/foo/**" },
          params: { _: s.slice(2).join("/") },
        };
    }
    if (s[1] === "fooo") {
    }
    if (l === 2 || l === 1) {
      if (m === "GET")
        if (l >= 2)
          return { data: { path: "/test/:id" }, params: { id: s[1] } };
    }
    if (s[2] === "y") {
      if (l === 3) {
        if (m === "GET")
          return { data: { path: "/test/:idY/y" }, params: { idY: s[1] } };
      }
      if (s[3] === "z") {
        if (l === 4) {
          if (m === "GET")
            return {
              data: { path: "/test/:idYZ/y/z" },
              params: { idYZ: s[1] },
            };
        }
      }
    }
  }
  if (s[0] === "another") {
    if (s[1] === "path") {
    }
  }
  if (s[0] === "wildcard") {
    if (m === "GET")
      return {
        data: { path: "/wildcard/**" },
        params: { _: s.slice(1).join("/") },
      };
  }
};
