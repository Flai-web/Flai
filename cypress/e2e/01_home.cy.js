// ─── Home Page ────────────────────────────────────────────────────────────────
// Tests core functionality of the landing page: rendering, navigation CTAs,
// and the hero section. We deliberately skip visual/copy details that change.

describe("Home Page", () => {
  beforeEach(() => {
    cy.visit("/");
  });

  it("loads successfully and shows the navbar", () => {
    cy.get("nav").should("exist");
    cy.url().should("eq", Cypress.config("baseUrl") + "/");
  });

  it("renders the hero / main section above the fold", () => {
    // The hero video section should be present
    cy.get("main, [class*='hero'], section").first().should("be.visible");
  });

  it("has a working navbar link to the products page", () => {
    // Find any nav link pointing to /products
    cy.get("nav").find('a[href="/products"], a[href*="products"]').first().click();
    cy.url().should("include", "/products");
  });

  it("has a working navbar link to the portfolio page", () => {
    cy.get("nav").find('a[href="/portfolio"], a[href*="portfolio"]').first().click();
    cy.url().should("include", "/portfolio");
  });

  it("footer is rendered at the bottom of the page", () => {
    cy.scrollTo("bottom");
    cy.get("footer").should("exist").and("be.visible");
  });

  it("footer contains a link to terms and policies", () => {
    cy.scrollTo("bottom");
    cy.get("footer").within(() => {
      cy.get('a[href*="terms"], a[href*="vilk"]').should("exist");
      cy.get('a[href*="polic"], a[href*="politik"]').should("exist");
    });
  });
});
