(m, p) => {
  let r = [];
  if (p.charCodeAt(p.length - 1) === 47) p = p.slice(0, -1) || "/";
  if (p === "/foo") {
    if (m === "GET") r.unshift({ data: $0 });
  } else if (p === "/foo/bar") {
    if (m === "GET") r.unshift({ data: $1 });
  } else if (p === "/foo/bar/baz") {
    if (m === "GET") r.unshift({ data: $2 });
  }
  let s = p.split("/"),
    l = s.length;
  if (l > 1) {
    if (s[1] === "foo") {
      if (l > 3) {
        if (s[3] === "baz") {
          if (l === 4) {
            if (m === "GET") r.unshift({ data: $3, params: { _0: s[2] } });
          }
        }
      }
      if (m === "GET")
        r.unshift({ data: $4, params: { _: s.slice(2).join("/") } });
    }
  }
  if (m === "GET") r.unshift({ data: $5, params: { _: s.slice(1).join("/") } });
  return r;
};
