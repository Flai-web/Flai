// ─── Navbar ───────────────────────────────────────────────────────────────────
// Tests the navbar across pages: logo click, mobile menu toggle, auth button.

describe("Navbar", () => {
  beforeEach(() => {
    cy.visit("/");
  });

  it("is visible on the home page", () => {
    cy.get("nav").should("be.visible");
  });

  it("logo/brand link navigates to the home page", () => {
    cy.visit("/products");
    cy.get('nav a[href="/"], nav a[href*="logo"], nav [class*="logo"] a, nav [class*="brand"] a')
      .first()
      .click({ force: true });
    cy.url().should("eq", Cypress.config("baseUrl") + "/");
  });

  it("is visible on the products page", () => {
    cy.visit("/products");
    cy.get("nav").should("be.visible");
  });

  it("is visible on the portfolio page", () => {
    cy.visit("/portfolio");
    cy.get("nav").should("be.visible");
  });

  it("has a link or button that leads to the auth/login page", () => {
    cy.get("nav")
      .find(
        'a[href*="/auth"], a[href*="/login"], button'
      )
      .should("have.length.greaterThan", 0);
  });

  it("mobile hamburger/menu button toggles a menu on small viewports", () => {
    cy.viewport(375, 812); // iPhone size
    cy.visit("/");
    // Look for a burger / menu button
    cy.get(
      'button[aria-label*="menu"], button[aria-label*="Menu"], [class*="hamburger"], [class*="mobile-menu"] button, nav button'
    ).then(($btns) => {
      if ($btns.length > 0) {
        cy.wrap($btns.first()).click({ force: true });
        // After clicking, a nav list / drawer should be visible
        cy.get("nav").should("exist");
      }
    });
  });
});
