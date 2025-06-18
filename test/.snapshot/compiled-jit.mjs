(m, p) => {
  if (p[p.length - 1] === "/") p = p.slice(0, -1) || "/";
  if (p === "/test") {
    if (m === "GET") return { data: d1 };
  }
  if (p === "/test/foo") {
    if (m === "GET") return { data: d2 };
  }
  if (p === "/test/foo/bar/qux") {
    if (m === "GET") return { data: d3 };
  }
  if (p === "/test/foo/baz") {
    if (m === "GET") return { data: d4 };
  }
  if (p === "/test/fooo") {
    if (m === "GET") return { data: d5 };
  }
  if (p === "/another/path") {
    if (m === "GET") return { data: d6 };
  }
  let [_, ...s] = p.split("/"),
    l = s.length;
  if (s[0] === "test") {
    if (s[1] === "foo") {
      if (l === 3 || l === 2) {
        if (m === "GET") return { data: d7, params: { _0: s[2] } };
      }
      if (m === "GET") return { data: d8, params: { _: s.slice(2).join("/") } };
    }
    if (l === 2 || l === 1) {
      if (m === "GET") if (l >= 2) return { data: d9, params: { id: s[1] } };
    }
    if (s[2] === "y") {
      if (l === 3) {
        if (m === "GET") return { data: d10, params: { idY: s[1] } };
      }
      if (s[3] === "z") {
        if (l === 4) {
          if (m === "GET") return { data: d11, params: { idYZ: s[1] } };
        }
      }
    }
  }
  if (s[0] === "wildcard") {
    if (m === "GET") return { data: d12, params: { _: s.slice(1).join("/") } };
  }
};
