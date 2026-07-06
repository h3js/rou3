(m, p) => {
  let r = [];
  if (p.charCodeAt(p.length - 1) === 47) p = p.slice(0, -1);
  if (p === "/foo") {
    if (m === "GET") {
      r.push({ data: $0 });
    }
  } else if (p === "/foo/bar") {
    if (m === "GET") {
      r.push({ data: $1 });
    }
  } else if (p === "/foo/bar/baz") {
    if (m === "GET") {
      r.push({ data: $2 });
    }
  }
  let s = p.split("/");
  if (s.length > 1 && s[s.length - 1] === "") {
    s.pop();
    p = p.slice(0, -1);
  }
  let l = s.length;
  if (l > 1) {
    if (s[1] === "foo") {
      if (l > 3) {
        if (s[3] === "baz") {
          if (l === 4) {
            if (m === "GET") {
              r.push({ data: $3, params: { 0: s[2] } });
            }
          }
        }
      }
      if (m === "GET") {
        r.push({ data: $4, params: { _: p.slice(5) } });
      }
    }
  }
  if (m === "GET") {
    r.push({ data: $5, params: { _: p.slice(1) } });
  }
  return r.reverse();
};
