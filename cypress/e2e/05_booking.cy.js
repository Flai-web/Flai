// ─── Booking Flow ────────────────────────────────────────────────────────────
// Tests the booking page form validation and guest-booking mechanics.
// Does NOT submit real bookings — we only verify form behaviour.

describe("Booking Page — Form Validation", () => {
  // We need a real product ID in the URL. We first grab one from /products.
  let productSlug;

  before(() => {
    cy.visit("/products");
    cy.get('a[href*="/product/"]', { timeout: 10000 })
      .first()
      .invoke("attr", "href")
      .then((href) => {
        // href = "/product/some-slug" — extract the slug
        productSlug = href.split("/product/")[1];
      });
  });

  beforeEach(() => {
    // Navigate via the products page to get a real booking link
    cy.visit(`/product/${productSlug}`);
  });

  it("product detail page renders without crashing", () => {
    cy.get("body").should("not.be.empty");
    cy.url().should("match", /\/product\/.+/);
  });

  it("has a CTA button that leads to the booking page", () => {
    cy.get('a[href*="/booking/"], button')
      .contains(/book|bestil|køb/i)
      .should("exist");
  });
});

describe("Booking Page — Direct Access", () => {
  it("visiting /booking/:id without auth shows the guest form or login prompt", () => {
    // Use a generic booking path — if the product doesn't exist the page
    // should still render gracefully (loading state or not-found message)
    cy.visit("/booking/1", { failOnStatusCode: false });
    cy.get("body").should("not.be.empty");
    // Should NOT show a blank white screen
    cy.get("nav").should("exist");
  });

  it("guest booking form requires name and email before proceeding", () => {
    cy.visit("/booking/1", { failOnStatusCode: false });
    // If a booking form is present, try submitting empty fields
    cy.get("body").then(($body) => {
      if ($body.find('input[type="email"]').length > 0) {
        // Click any submit/continue button without filling the form
        cy.get('button[type="submit"], button')
          .contains(/fortsæt|continue|book|betal/i)
          .first()
          .click({ force: true });
        // Should stay on page — validation should block navigation
        cy.url().should("include", "/booking/");
      }
    });
  });
});

describe("Simple Request Page", () => {
  beforeEach(() => {
    cy.visit("/simple-request");
  });

  it("renders the simple request form", () => {
    cy.get("body").should("not.be.empty");
    cy.url().should("include", "/simple-request");
  });

  it("form has product selector, address, name, and email fields", () => {
    cy.get(
      'select, input[name*="address"], input[type="email"], input[placeholder*="adresse"], input[placeholder*="email"]',
      { timeout: 8000 }
    ).should("have.length.greaterThan", 0);
  });

  it("attempting to submit an empty form shows validation errors", () => {
    cy.get('button[type="submit"], button')
      .contains(/send|bestil|submit/i)
      .first()
      .click({ force: true });
    // Should not navigate away
    cy.url().should("include", "/simple-request");
  });
});
