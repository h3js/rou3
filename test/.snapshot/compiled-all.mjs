(m, p) => {
  let r = [],
    k = [];
  if (p.charCodeAt(p.length - 1) === 47) p = p.slice(0, -1);
  if (p === "/foo") {
    if (m === "GET") {
      {
        r.push({ data: $0 });
        k.push($1);
      }
    }
  } else if (p === "/foo/bar") {
    if (m === "GET") {
      {
        r.push({ data: $2 });
        k.push($1);
      }
    }
  } else if (p === "/foo/bar/baz") {
    if (m === "GET") {
      {
        r.push({ data: $3 });
        k.push($1);
      }
    }
  }
  let s = p.split("/");
  let l = s.length;
  let _w;
  if (l > 1) {
    if (s[1] === "foo") {
      if (l > 2) {
        if (s[l - 1] === "baz") {
          if (m === "GET") {
            if (l > 3) {
              r.push({ data: $4, params: { 0: p.slice(5, p.length - 4) } });
              k.push($5);
            }
          }
        }
      }
      if (m === "GET") {
        {
          r.push(
            l > 2
              ? { data: $6, params: { 0: (_w = p.slice(5)), _: _w } }
              : { data: $6, params: {} },
          );
          k.push($7);
        }
      }
    }
  }
  if (m === "GET") {
    {
      r.push(
        l > 1 ? { data: $8, params: { 0: (_w = p.slice(1)), _: _w } } : { data: $8, params: {} },
      );
      k.push($9);
    }
  }
  return $10(r.reverse(), k.reverse(), l - 1);
};
