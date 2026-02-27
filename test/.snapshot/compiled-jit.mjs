(m, p) => {
  if (p.charCodeAt(p.length - 1) === 47) p = p.slice(0, -1) || "/";
  if (p === "/test") {
    if (m === "GET") return { data: $0 };
  } else if (p === "/test/foo") {
    if (m === "GET") return { data: $1 };
  } else if (p === "/test/foo/bar/qux") {
    if (m === "GET") return { data: $2 };
  } else if (p === "/test/foo/baz") {
    if (m === "GET") return { data: $3 };
  } else if (p === "/test/fooo") {
    if (m === "GET") return { data: $4 };
  } else if (p === "/another/path") {
    if (m === "GET") return { data: $5 };
  } else if (p === "/static%3Apath/*/**") {
    if (m === "GET") return { data: $6 };
  }
  let s = p.split("/"),
    l = s.length;
  if (l > 1) {
    if (s[1] === "test") {
      if (l > 2) {
        if (s[2] === "foo") {
          if (l === 4 || l === 3) {
            if (m === "GET") return { data: $7, params: { 0: s[3] } };
          }
          if (m === "GET")
            return { data: $8, params: { _: s.slice(3).join("/") } };
        }
      }
      if (l === 3 || l === 2) {
        if (m === "GET") if (l > 2) return { data: $9, params: { id: s[2] } };
      } else if (s[3] === "y") {
        if (l === 4) {
          if (m === "GET") return { data: $10, params: { idY: s[2] } };
        } else if (s[4] === "z") {
          if (l === 5) {
            if (m === "GET") return { data: $11, params: { idYZ: s[2] } };
          }
        }
      }
    } else if (s[1] === "wildcard") {
      if (m === "GET")
        return { data: $12, params: { _: s.slice(2).join("/") } };
    }
  }
  if (m === "GET") return { data: $13, params: { _: s.slice(1).join("/") } };
};
