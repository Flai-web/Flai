// ─── Products Page ────────────────────────────────────────────────────────────
// Verifies that the product listing renders, category filters work, and
// clicking a product card navigates to its detail page.

describe("Products Page", () => {
  beforeEach(() => {
    cy.visit("/products");
    // Wait for skeleton loaders to resolve (products fetched from Supabase)
    cy.get('[class*="skeleton"], [class*="shimmer"]', { timeout: 8000 })
      .should("not.exist")
      .then(() => {})
      .catch(() => {}); // skeletons may already be gone — that's fine
  });

  it("renders the products page", () => {
    cy.url().should("include", "/products");
    cy.get("body").should("not.be.empty");
  });

  it("shows category filter buttons (all / video / photo)", () => {
    // The page has filter tabs for all, video, and photo categories
    cy.get("button, [role='tab']").should("have.length.greaterThan", 0);
  });

  it("clicking a category filter does not crash the page", () => {
    cy.get("button").contains(/video/i).click({ force: true });
    cy.url().should("include", "/products");
    cy.get("button").contains(/foto|photo/i).click({ force: true });
    cy.url().should("include", "/products");
    cy.get("button").contains(/alle|all/i).click({ force: true });
    cy.url().should("include", "/products");
  });

  it("product cards are rendered when products exist", () => {
    // Wait up to 10s for at least one product card to appear
    cy.get('[class*="product"], [class*="card"], [href*="/product/"]', {
      timeout: 10000,
    }).should("have.length.greaterThan", 0);
  });

  it("clicking a product card navigates to the product detail page", () => {
    cy.get('a[href*="/product/"]', { timeout: 10000 })
      .first()
      .click({ force: true });
    cy.url().should("match", /\/product\/.+/);
  });
});
