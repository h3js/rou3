(m, p) => {
  let r = [];
  if (p.charCodeAt(p.length - 1) === 47) p = p.slice(0, -1) || "/";
  if (p === "/foo") {
    if (m === "GET") r.unshift({ data: d1 });
  }
  if (p === "/foo/bar") {
    if (m === "GET") r.unshift({ data: d2 });
  }
  if (p === "/foo/bar/baz") {
    if (m === "GET") r.unshift({ data: d3 });
  }
  let s = p.split("/"),
    l = s.length - 1;
  if (s[1] === "foo") {
    if (s[3] === "baz") {
      if (l === 3) {
        if (m === "GET") r.unshift({ data: d4, params: { _0: s[2] } });
      }
    }
    if (m === "GET")
      r.unshift({ data: d5, params: { _: s.slice(2).join("/") } });
  }
  if (m === "GET") r.unshift({ data: d6, params: { _: s.slice(1).join("/") } });
  return r;
};
