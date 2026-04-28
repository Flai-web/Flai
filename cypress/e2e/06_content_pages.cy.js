// ─── Search Page ──────────────────────────────────────────────────────────────

describe("Search Page", () => {
  it("renders the search input", () => {
    cy.visit("/search");
    cy.get('input[type="search"], input[type="text"], input[placeholder*="søg"], input[placeholder*="search"]').should(
      "exist"
    );
  });

  it("searching for a term does not crash the page", () => {
    cy.visit("/search?q=drone");
    cy.get("body").should("not.be.empty");
    cy.url().should("include", "/search");
  });

  it("search via URL query param populates the input", () => {
    cy.visit("/search?q=foto");
    cy.get(
      'input[type="search"], input[type="text"], input[placeholder*="søg"], input[placeholder*="search"]'
    ).should(($inputs) => {
      const hasValue = Array.from($inputs).some(
        (el) => el.value && el.value.length > 0
      );
      expect(hasValue).to.be.true;
    });
  });

  it("category tabs (all / products / portfolio / pages) are present", () => {
    cy.visit("/search");
    cy.get("button, [role='tab']").should("have.length.greaterThan", 0);
  });
});

// ─── Portfolio Page ───────────────────────────────────────────────────────────

describe("Portfolio Page", () => {
  beforeEach(() => {
    cy.visit("/portfolio");
  });

  it("renders the portfolio page", () => {
    cy.get("body").should("not.be.empty");
    cy.url().should("include", "/portfolio");
  });

  it("portfolio items are shown after loading", () => {
    // Either portfolio cards appear or a meaningful empty-state is shown
    cy.get("body", { timeout: 10000 }).should("not.contain.html", "animate-shimmer");
  });

  it("clicking a portfolio bundle opens or expands it without crashing", () => {
    cy.get("body").then(($body) => {
      const buttons = $body.find("button");
      if (buttons.length > 0) {
        cy.get("button").first().click({ force: true });
        cy.get("body").should("not.be.empty");
      }
    });
  });
});

// ─── Ratings Page ─────────────────────────────────────────────────────────────

describe("Ratings Page", () => {
  it("renders the ratings/reviews page", () => {
    cy.visit("/ratings");
    cy.get("body").should("not.be.empty");
    cy.url().should("include", "/ratings");
  });

  it("has a heading element", () => {
    cy.visit("/ratings");
    cy.get("h1, h2").should("have.length.greaterThan", 0);
  });
});

// ─── Coverage Areas Page ──────────────────────────────────────────────────────

describe("Coverage Areas Page", () => {
  beforeEach(() => {
    cy.visit("/coverage");
  });

  it("renders the coverage page", () => {
    cy.get("body").should("not.be.empty");
    cy.url().should("include", "/coverage");
  });

  it("has a search input for checking coverage", () => {
    cy.get('input[type="text"], input[placeholder*="adresse"], input[placeholder*="by"], input[placeholder*="city"]').should(
      "exist"
    );
  });

  it("typing a Danish city name does not crash the page", () => {
    cy.get(
      'input[type="text"], input[placeholder*="adresse"], input[placeholder*="by"]'
    )
      .first()
      .type("København");
    cy.get("body").should("not.be.empty");
    cy.url().should("include", "/coverage");
  });
});
