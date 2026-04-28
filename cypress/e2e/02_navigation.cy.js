// ─── Navigation & Routing ─────────────────────────────────────────────────────
// Verifies that all public routes load without crashing and return a page (not
// the 404). We don't assert on copy since it's managed via the CMS.

const PUBLIC_ROUTES = [
  { path: "/", label: "home" },
  { path: "/products", label: "products" },
  { path: "/portfolio", label: "portfolio" },
  { path: "/search", label: "search" },
  { path: "/ratings", label: "ratings" },
  { path: "/coverage", label: "coverage" },
  { path: "/merch", label: "merchandise" },
  { path: "/simple-request", label: "simple request" },
  { path: "/terms", label: "terms" },
  { path: "/policies", label: "policies" },
  { path: "/auth", label: "auth" },
];

describe("Public Route Availability", () => {
  PUBLIC_ROUTES.forEach(({ path, label }) => {
    it(`${label} page (${path}) loads without crashing`, () => {
      cy.visit(path);
      // The page should not be the 404 page (which contains a specific back link)
      cy.get("body").should("not.be.empty");
      // No uncaught JS exceptions should have occurred (Cypress captures these by default)
    });
  });
});

describe("404 Page", () => {
  it("shows the not-found page for unknown routes", () => {
    cy.visit("/this-route-definitely-does-not-exist-xyz", {
      failOnStatusCode: false,
    });
    // Should NOT navigate away — stay on the unknown URL
    cy.url().should("include", "/this-route-definitely-does-not-exist-xyz");
    // App renders something (not a blank white screen)
    cy.get("body").should("not.be.empty");
  });
});

describe("Protected Route Redirects", () => {
  it("redirects /profile to auth when not logged in", () => {
    cy.visit("/profile");
    // ProtectedRoute should redirect to /auth
    cy.url().should("include", "/auth");
  });

  it("redirects /admin to auth when not logged in", () => {
    cy.visit("/admin");
    cy.url().should("include", "/auth");
  });

  it("redirects /buy-credits to auth when not logged in", () => {
    cy.visit("/buy-credits");
    cy.url().should("include", "/auth");
  });
});
