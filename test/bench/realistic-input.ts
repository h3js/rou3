// Realistic route sets modeled after real-world REST APIs
// (e-commerce, SaaS dashboard, CMS, social platform)

export interface Route {
  method: string;
  path: string;
}

export interface Request {
  method: string;
  path: string;
  description: string;
}

// --- E-commerce API (100+ routes) ---

export const ecommerceRoutes: Route[] = [
  // Auth
  { method: "POST", path: "/auth/login" },
  { method: "POST", path: "/auth/register" },
  { method: "POST", path: "/auth/logout" },
  { method: "POST", path: "/auth/refresh" },
  { method: "POST", path: "/auth/forgot-password" },
  { method: "POST", path: "/auth/reset-password" },
  { method: "GET", path: "/auth/verify/:token" },

  // Users
  { method: "GET", path: "/users" },
  { method: "GET", path: "/users/:id" },
  { method: "PUT", path: "/users/:id" },
  { method: "DELETE", path: "/users/:id" },
  { method: "GET", path: "/users/:id/orders" },
  { method: "GET", path: "/users/:id/addresses" },
  { method: "POST", path: "/users/:id/addresses" },
  { method: "PUT", path: "/users/:id/addresses/:addressId" },
  { method: "DELETE", path: "/users/:id/addresses/:addressId" },
  { method: "GET", path: "/users/:id/wishlist" },
  { method: "POST", path: "/users/:id/wishlist" },
  { method: "DELETE", path: "/users/:id/wishlist/:itemId" },
  { method: "GET", path: "/users/:id/reviews" },
  { method: "GET", path: "/users/:id/notifications" },
  { method: "PUT", path: "/users/:id/notifications/settings" },

  // Products
  { method: "GET", path: "/products" },
  { method: "GET", path: "/products/featured" },
  { method: "GET", path: "/products/new-arrivals" },
  { method: "GET", path: "/products/best-sellers" },
  { method: "GET", path: "/products/search" },
  { method: "GET", path: "/products/:id" },
  { method: "POST", path: "/products" },
  { method: "PUT", path: "/products/:id" },
  { method: "DELETE", path: "/products/:id" },
  { method: "GET", path: "/products/:id/reviews" },
  { method: "POST", path: "/products/:id/reviews" },
  { method: "GET", path: "/products/:id/reviews/:reviewId" },
  { method: "PUT", path: "/products/:id/reviews/:reviewId" },
  { method: "DELETE", path: "/products/:id/reviews/:reviewId" },
  { method: "GET", path: "/products/:id/variants" },
  { method: "POST", path: "/products/:id/variants" },
  { method: "PUT", path: "/products/:id/variants/:variantId" },
  { method: "DELETE", path: "/products/:id/variants/:variantId" },
  { method: "GET", path: "/products/:id/images" },
  { method: "POST", path: "/products/:id/images" },
  { method: "DELETE", path: "/products/:id/images/:imageId" },
  { method: "GET", path: "/products/:id/related" },
  { method: "GET", path: "/products/:id/questions" },
  { method: "POST", path: "/products/:id/questions" },

  // Categories
  { method: "GET", path: "/categories" },
  { method: "GET", path: "/categories/:id" },
  { method: "GET", path: "/categories/:id/products" },
  { method: "GET", path: "/categories/:id/subcategories" },
  { method: "POST", path: "/categories" },
  { method: "PUT", path: "/categories/:id" },
  { method: "DELETE", path: "/categories/:id" },

  // Cart
  { method: "GET", path: "/cart" },
  { method: "POST", path: "/cart/items" },
  { method: "PUT", path: "/cart/items/:itemId" },
  { method: "DELETE", path: "/cart/items/:itemId" },
  { method: "POST", path: "/cart/coupon" },
  { method: "DELETE", path: "/cart/coupon" },
  { method: "GET", path: "/cart/shipping-estimates" },

  // Orders
  { method: "GET", path: "/orders" },
  { method: "GET", path: "/orders/:id" },
  { method: "POST", path: "/orders" },
  { method: "PUT", path: "/orders/:id" },
  { method: "POST", path: "/orders/:id/cancel" },
  { method: "GET", path: "/orders/:id/tracking" },
  { method: "GET", path: "/orders/:id/invoice" },
  { method: "POST", path: "/orders/:id/return" },
  { method: "GET", path: "/orders/:id/items" },
  { method: "GET", path: "/orders/:id/items/:itemId" },

  // Payments
  { method: "GET", path: "/payments/methods" },
  { method: "POST", path: "/payments/methods" },
  { method: "DELETE", path: "/payments/methods/:id" },
  { method: "POST", path: "/payments/process" },
  { method: "GET", path: "/payments/:id" },
  { method: "POST", path: "/payments/:id/refund" },

  // Inventory
  { method: "GET", path: "/inventory" },
  { method: "GET", path: "/inventory/:sku" },
  { method: "PUT", path: "/inventory/:sku" },
  { method: "GET", path: "/inventory/warehouses" },
  { method: "GET", path: "/inventory/warehouses/:id" },
  { method: "GET", path: "/inventory/warehouses/:id/stock" },

  // Shipping
  { method: "GET", path: "/shipping/carriers" },
  { method: "GET", path: "/shipping/rates" },
  { method: "POST", path: "/shipping/labels" },
  { method: "GET", path: "/shipping/labels/:id" },
  { method: "GET", path: "/shipping/tracking/:trackingNumber" },

  // Admin
  { method: "GET", path: "/admin/dashboard" },
  { method: "GET", path: "/admin/analytics" },
  { method: "GET", path: "/admin/analytics/sales" },
  { method: "GET", path: "/admin/analytics/traffic" },
  { method: "GET", path: "/admin/analytics/conversions" },
  { method: "GET", path: "/admin/reports" },
  { method: "GET", path: "/admin/reports/:type" },
  { method: "GET", path: "/admin/settings" },
  { method: "PUT", path: "/admin/settings" },
  { method: "GET", path: "/admin/users" },
  { method: "GET", path: "/admin/users/:id" },
  { method: "PUT", path: "/admin/users/:id/role" },

  // Webhooks
  { method: "GET", path: "/webhooks" },
  { method: "POST", path: "/webhooks" },
  { method: "GET", path: "/webhooks/:id" },
  { method: "PUT", path: "/webhooks/:id" },
  { method: "DELETE", path: "/webhooks/:id" },

  // API versioning / misc
  { method: "GET", path: "/health" },
  { method: "GET", path: "/version" },
  { method: "GET", path: "/docs/**" },
  { method: "GET", path: "/assets/**" },
];

// Requests that exercise different route types and depths
export const ecommerceRequests: Request[] = [
  // Static routes (fastest path)
  { method: "GET", path: "/health", description: "static: shallow" },
  { method: "GET", path: "/products", description: "static: common" },
  { method: "GET", path: "/products/featured", description: "static: 2-level" },
  { method: "GET", path: "/admin/dashboard", description: "static: admin" },
  { method: "GET", path: "/admin/analytics/sales", description: "static: 3-level deep" },
  { method: "GET", path: "/cart", description: "static: short" },
  { method: "GET", path: "/cart/shipping-estimates", description: "static: nested" },
  { method: "POST", path: "/auth/login", description: "static: POST" },
  { method: "POST", path: "/auth/register", description: "static: POST 2" },
  { method: "GET", path: "/payments/methods", description: "static: payments" },

  // Single param routes
  { method: "GET", path: "/users/usr_42abc", description: "param: single" },
  { method: "GET", path: "/products/prod_99xyz", description: "param: product" },
  { method: "GET", path: "/orders/ord_12345", description: "param: order" },
  { method: "GET", path: "/categories/cat_electronics", description: "param: category" },
  { method: "GET", path: "/webhooks/wh_7890", description: "param: webhook" },
  { method: "DELETE", path: "/users/usr_42abc", description: "param: DELETE" },
  { method: "PUT", path: "/products/prod_99xyz", description: "param: PUT" },

  // Multi param routes
  { method: "PUT", path: "/users/usr_42abc/addresses/addr_1", description: "multi-param: 2 params" },
  { method: "GET", path: "/products/prod_99xyz/reviews/rev_555", description: "multi-param: nested" },
  { method: "DELETE", path: "/products/prod_99xyz/variants/var_3", description: "multi-param: delete" },
  { method: "GET", path: "/orders/ord_12345/items/item_1", description: "multi-param: order item" },

  // Param with static siblings (tests priority)
  { method: "GET", path: "/products/prod_99xyz/reviews", description: "param+static: reviews list" },
  { method: "GET", path: "/products/prod_99xyz/related", description: "param+static: related" },
  { method: "GET", path: "/users/usr_42abc/orders", description: "param+static: user orders" },
  { method: "GET", path: "/users/usr_42abc/wishlist", description: "param+static: user wishlist" },

  // Deep static paths
  { method: "GET", path: "/admin/analytics/conversions", description: "deep-static: 3-level" },
  { method: "GET", path: "/inventory/warehouses", description: "deep-static: warehouses" },

  // Wildcard routes
  { method: "GET", path: "/docs/api/v2/reference", description: "wildcard: docs deep" },
  { method: "GET", path: "/assets/css/main.css", description: "wildcard: assets" },
  { method: "GET", path: "/docs/getting-started", description: "wildcard: docs shallow" },

  // Not found (miss performance)
  { method: "GET", path: "/nonexistent", description: "miss: root level" },
  { method: "GET", path: "/users/usr_42abc/unknown", description: "miss: nested" },
  { method: "PATCH", path: "/products/prod_99xyz", description: "miss: wrong method" },
];

// --- GitHub-like API (200+ routes) ---

export const githubLikeRoutes: Route[] = [
  // Repos
  { method: "GET", path: "/repos/:owner/:repo" },
  { method: "GET", path: "/repos/:owner/:repo/contents/:path" },
  { method: "GET", path: "/repos/:owner/:repo/commits" },
  { method: "GET", path: "/repos/:owner/:repo/commits/:sha" },
  { method: "GET", path: "/repos/:owner/:repo/branches" },
  { method: "GET", path: "/repos/:owner/:repo/branches/:branch" },
  { method: "GET", path: "/repos/:owner/:repo/tags" },
  { method: "GET", path: "/repos/:owner/:repo/releases" },
  { method: "GET", path: "/repos/:owner/:repo/releases/:id" },
  { method: "POST", path: "/repos/:owner/:repo/releases" },
  { method: "GET", path: "/repos/:owner/:repo/releases/latest" },
  { method: "GET", path: "/repos/:owner/:repo/contributors" },
  { method: "GET", path: "/repos/:owner/:repo/languages" },
  { method: "GET", path: "/repos/:owner/:repo/stargazers" },
  { method: "GET", path: "/repos/:owner/:repo/forks" },
  { method: "POST", path: "/repos/:owner/:repo/forks" },

  // Issues
  { method: "GET", path: "/repos/:owner/:repo/issues" },
  { method: "GET", path: "/repos/:owner/:repo/issues/:number" },
  { method: "POST", path: "/repos/:owner/:repo/issues" },
  { method: "PATCH", path: "/repos/:owner/:repo/issues/:number" },
  { method: "GET", path: "/repos/:owner/:repo/issues/:number/comments" },
  { method: "POST", path: "/repos/:owner/:repo/issues/:number/comments" },
  { method: "GET", path: "/repos/:owner/:repo/issues/:number/labels" },
  { method: "POST", path: "/repos/:owner/:repo/issues/:number/labels" },
  { method: "DELETE", path: "/repos/:owner/:repo/issues/:number/labels/:name" },
  { method: "GET", path: "/repos/:owner/:repo/issues/:number/reactions" },
  { method: "POST", path: "/repos/:owner/:repo/issues/:number/reactions" },

  // Pull requests
  { method: "GET", path: "/repos/:owner/:repo/pulls" },
  { method: "GET", path: "/repos/:owner/:repo/pulls/:number" },
  { method: "POST", path: "/repos/:owner/:repo/pulls" },
  { method: "PATCH", path: "/repos/:owner/:repo/pulls/:number" },
  { method: "GET", path: "/repos/:owner/:repo/pulls/:number/commits" },
  { method: "GET", path: "/repos/:owner/:repo/pulls/:number/files" },
  { method: "GET", path: "/repos/:owner/:repo/pulls/:number/reviews" },
  { method: "POST", path: "/repos/:owner/:repo/pulls/:number/reviews" },
  { method: "PUT", path: "/repos/:owner/:repo/pulls/:number/merge" },
  { method: "GET", path: "/repos/:owner/:repo/pulls/:number/comments" },
  { method: "POST", path: "/repos/:owner/:repo/pulls/:number/comments" },

  // Actions / CI
  { method: "GET", path: "/repos/:owner/:repo/actions/workflows" },
  { method: "GET", path: "/repos/:owner/:repo/actions/workflows/:id" },
  { method: "GET", path: "/repos/:owner/:repo/actions/workflows/:id/runs" },
  { method: "POST", path: "/repos/:owner/:repo/actions/workflows/:id/dispatches" },
  { method: "GET", path: "/repos/:owner/:repo/actions/runs" },
  { method: "GET", path: "/repos/:owner/:repo/actions/runs/:runId" },
  { method: "GET", path: "/repos/:owner/:repo/actions/runs/:runId/jobs" },
  { method: "GET", path: "/repos/:owner/:repo/actions/runs/:runId/logs" },
  { method: "POST", path: "/repos/:owner/:repo/actions/runs/:runId/cancel" },
  { method: "POST", path: "/repos/:owner/:repo/actions/runs/:runId/rerun" },
  { method: "GET", path: "/repos/:owner/:repo/actions/artifacts" },
  { method: "GET", path: "/repos/:owner/:repo/actions/artifacts/:id" },

  // Hooks
  { method: "GET", path: "/repos/:owner/:repo/hooks" },
  { method: "GET", path: "/repos/:owner/:repo/hooks/:id" },
  { method: "POST", path: "/repos/:owner/:repo/hooks" },
  { method: "PATCH", path: "/repos/:owner/:repo/hooks/:id" },
  { method: "DELETE", path: "/repos/:owner/:repo/hooks/:id" },
  { method: "POST", path: "/repos/:owner/:repo/hooks/:id/pings" },

  // Collaborators
  { method: "GET", path: "/repos/:owner/:repo/collaborators" },
  { method: "GET", path: "/repos/:owner/:repo/collaborators/:username" },
  { method: "PUT", path: "/repos/:owner/:repo/collaborators/:username" },
  { method: "DELETE", path: "/repos/:owner/:repo/collaborators/:username" },

  // Git data
  { method: "GET", path: "/repos/:owner/:repo/git/refs" },
  { method: "GET", path: "/repos/:owner/:repo/git/refs/:ref" },
  { method: "POST", path: "/repos/:owner/:repo/git/refs" },
  { method: "GET", path: "/repos/:owner/:repo/git/commits/:sha" },
  { method: "POST", path: "/repos/:owner/:repo/git/commits" },
  { method: "GET", path: "/repos/:owner/:repo/git/trees/:sha" },
  { method: "POST", path: "/repos/:owner/:repo/git/trees" },
  { method: "GET", path: "/repos/:owner/:repo/git/blobs/:sha" },
  { method: "POST", path: "/repos/:owner/:repo/git/blobs" },

  // Deployments
  { method: "GET", path: "/repos/:owner/:repo/deployments" },
  { method: "GET", path: "/repos/:owner/:repo/deployments/:id" },
  { method: "POST", path: "/repos/:owner/:repo/deployments" },
  { method: "GET", path: "/repos/:owner/:repo/deployments/:id/statuses" },
  { method: "POST", path: "/repos/:owner/:repo/deployments/:id/statuses" },

  // Users
  { method: "GET", path: "/user" },
  { method: "GET", path: "/user/repos" },
  { method: "GET", path: "/user/orgs" },
  { method: "GET", path: "/user/starred" },
  { method: "GET", path: "/user/following" },
  { method: "GET", path: "/user/followers" },
  { method: "GET", path: "/users/:username" },
  { method: "GET", path: "/users/:username/repos" },
  { method: "GET", path: "/users/:username/orgs" },
  { method: "GET", path: "/users/:username/starred" },
  { method: "GET", path: "/users/:username/gists" },
  { method: "GET", path: "/users/:username/followers" },
  { method: "GET", path: "/users/:username/following" },

  // Orgs
  { method: "GET", path: "/orgs/:org" },
  { method: "GET", path: "/orgs/:org/repos" },
  { method: "GET", path: "/orgs/:org/members" },
  { method: "GET", path: "/orgs/:org/members/:username" },
  { method: "GET", path: "/orgs/:org/teams" },
  { method: "GET", path: "/orgs/:org/teams/:teamSlug" },
  { method: "GET", path: "/orgs/:org/teams/:teamSlug/members" },
  { method: "GET", path: "/orgs/:org/teams/:teamSlug/repos" },

  // Search
  { method: "GET", path: "/search/repositories" },
  { method: "GET", path: "/search/code" },
  { method: "GET", path: "/search/issues" },
  { method: "GET", path: "/search/users" },
  { method: "GET", path: "/search/topics" },
  { method: "GET", path: "/search/commits" },

  // Gists
  { method: "GET", path: "/gists" },
  { method: "GET", path: "/gists/:id" },
  { method: "POST", path: "/gists" },
  { method: "PATCH", path: "/gists/:id" },
  { method: "DELETE", path: "/gists/:id" },
  { method: "GET", path: "/gists/:id/comments" },
  { method: "POST", path: "/gists/:id/comments" },

  // Notifications
  { method: "GET", path: "/notifications" },
  { method: "PUT", path: "/notifications" },
  { method: "GET", path: "/notifications/threads/:id" },
  { method: "PATCH", path: "/notifications/threads/:id" },

  // Misc
  { method: "GET", path: "/rate_limit" },
  { method: "GET", path: "/meta" },
  { method: "GET", path: "/emojis" },
  { method: "GET", path: "/gitignore/templates" },
  { method: "GET", path: "/gitignore/templates/:name" },
  { method: "GET", path: "/licenses" },
  { method: "GET", path: "/licenses/:key" },
];

export const githubLikeRequests: Request[] = [
  // Static
  { method: "GET", path: "/user", description: "static: authed user" },
  { method: "GET", path: "/user/repos", description: "static: user repos" },
  { method: "GET", path: "/notifications", description: "static: notifications" },
  { method: "GET", path: "/rate_limit", description: "static: rate limit" },
  { method: "GET", path: "/search/repositories", description: "static: search" },
  { method: "GET", path: "/emojis", description: "static: misc" },

  // Shallow param
  { method: "GET", path: "/users/octocat", description: "param: user profile" },
  { method: "GET", path: "/orgs/github", description: "param: org" },
  { method: "GET", path: "/gists/abc123", description: "param: gist" },
  { method: "GET", path: "/licenses/mit", description: "param: license" },

  // 2-param routes (most common GitHub pattern)
  { method: "GET", path: "/repos/facebook/react", description: "2-param: repo" },
  { method: "GET", path: "/repos/vercel/next.js/commits", description: "2-param+static: commits" },
  { method: "GET", path: "/repos/denoland/deno/branches", description: "2-param+static: branches" },
  { method: "GET", path: "/repos/nodejs/node/releases", description: "2-param+static: releases" },
  { method: "GET", path: "/repos/golang/go/stargazers", description: "2-param+static: stargazers" },
  { method: "GET", path: "/repos/microsoft/vscode/issues", description: "2-param+static: issues" },
  { method: "GET", path: "/repos/torvalds/linux/pulls", description: "2-param+static: pulls" },
  { method: "POST", path: "/repos/myorg/myrepo/issues", description: "2-param: POST issue" },

  // 3-param deep routes
  { method: "GET", path: "/repos/facebook/react/issues/1234", description: "3-param: issue" },
  { method: "GET", path: "/repos/vercel/next.js/pulls/5678", description: "3-param: PR" },
  { method: "GET", path: "/repos/nodejs/node/releases/v20.0.0", description: "3-param: release" },
  { method: "GET", path: "/repos/denoland/deno/hooks/hook_1", description: "3-param: hook" },

  // 3-param + static suffix (deepest common paths)
  { method: "GET", path: "/repos/facebook/react/issues/1234/comments", description: "3-param+static: comments" },
  { method: "GET", path: "/repos/vercel/next.js/pulls/5678/files", description: "3-param+static: PR files" },
  { method: "GET", path: "/repos/nodejs/node/pulls/9999/reviews", description: "3-param+static: PR reviews" },
  { method: "GET", path: "/repos/denoland/deno/actions/runs/12345/jobs", description: "deep: CI jobs" },
  { method: "POST", path: "/repos/myorg/myrepo/actions/runs/99/cancel", description: "deep: cancel run" },

  // 4-param routes
  { method: "DELETE", path: "/repos/facebook/react/issues/1234/labels/bug", description: "4-param: remove label" },
  { method: "GET", path: "/repos/facebook/react/deployments/dep1/statuses", description: "4-param: deploy status" },

  // Miss scenarios
  { method: "GET", path: "/repos/facebook/react/unknown", description: "miss: unknown sub-resource" },
  { method: "DELETE", path: "/notifications", description: "miss: wrong method" },
  { method: "GET", path: "/v2/repos/facebook/react", description: "miss: wrong prefix" },
];

// --- Utility: generate route scale sets ---

const RESOURCE_NAMES = [
  "users", "posts", "comments", "tags", "categories", "files",
  "projects", "tasks", "events", "teams", "roles", "permissions",
  "invoices", "subscriptions", "plans", "coupons", "notifications",
  "messages", "channels", "threads", "reactions", "bookmarks",
  "settings", "preferences", "tokens", "sessions", "logs",
  "metrics", "alerts", "rules", "workflows", "pipelines",
];

const API_PREFIXES = ["", "/api/v1", "/api/v2", "/internal"];

const ACTIONS = ["archive", "restore", "publish", "unpublish", "duplicate", "export", "import", "sync"];

export function generateScaleRoutes(count: number): { routes: Route[]; requests: Request[] } {
  const routes: Route[] = [];
  const requests: Request[] = [];

  outer:
  for (const prefix of API_PREFIXES) {
    for (const resource of RESOURCE_NAMES) {
      const p = `${prefix}/${resource}`;

      // Standard CRUD (5 routes)
      routes.push(
        { method: "GET", path: p },
        { method: "POST", path: p },
        { method: "GET", path: `${p}/:id` },
        { method: "PUT", path: `${p}/:id` },
        { method: "DELETE", path: `${p}/:id` },
      );

      // Nested sub-resources (4 routes)
      routes.push(
        { method: "GET", path: `${p}/:id/comments` },
        { method: "POST", path: `${p}/:id/comments` },
        { method: "GET", path: `${p}/:id/comments/:commentId` },
        { method: "DELETE", path: `${p}/:id/comments/:commentId` },
      );

      // Action (1 route)
      routes.push({ method: "POST", path: `${p}/:id/${ACTIONS[routes.length % ACTIONS.length]}` });

      // Sample requests (first prefix only to keep request count reasonable)
      if (prefix === "") {
        requests.push(
          { method: "GET", path: p, description: `static: ${resource} list` },
          { method: "GET", path: `${p}/item_42`, description: `param: ${resource} detail` },
          { method: "GET", path: `${p}/item_42/comments`, description: `param+static: ${resource} comments` },
          { method: "GET", path: `${p}/item_42/comments/c_1`, description: `multi-param: ${resource} comment` },
        );
      }

      if (routes.length >= count) break outer;
    }
  }

  return { routes: routes.slice(0, count), requests };
}

// --- findAllRoutes test set (overlapping routes) ---

export const overlappingRoutes: Route[] = [
  // Method-less (match all methods) + method-specific
  { method: "", path: "/api/:version/resource" },
  { method: "GET", path: "/api/:version/resource" },
  { method: "POST", path: "/api/:version/resource" },

  { method: "", path: "/middleware/**" },
  { method: "GET", path: "/middleware/auth" },
  { method: "GET", path: "/middleware/logging" },

  { method: "", path: "/**" },
  { method: "GET", path: "/public/**" },
  { method: "GET", path: "/public/assets/**" },

  { method: "", path: "/hooks/:event" },
  { method: "POST", path: "/hooks/:event" },
  { method: "POST", path: "/hooks/deploy" },
];

export const overlappingRequests: Request[] = [
  { method: "GET", path: "/api/v1/resource", description: "overlap: GET versioned" },
  { method: "POST", path: "/api/v2/resource", description: "overlap: POST versioned" },
  { method: "GET", path: "/middleware/auth", description: "overlap: wildcard + static" },
  { method: "GET", path: "/public/assets/style.css", description: "overlap: nested wildcard" },
  { method: "POST", path: "/hooks/deploy", description: "overlap: param + static + catch-all" },
  { method: "GET", path: "/anything/goes/here", description: "overlap: catch-all only" },
];
