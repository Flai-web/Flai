// ─── Legal & Static Pages ─────────────────────────────────────────────────────

describe("Terms Page", () => {
  it("renders the terms page with content", () => {
    cy.visit("/terms");
    cy.get("body").should("not.be.empty");
    cy.get("h1, h2").should("have.length.greaterThan", 0);
  });
});

describe("Policies Page", () => {
  it("renders the policies/privacy page with content", () => {
    cy.visit("/policies");
    cy.get("body").should("not.be.empty");
    cy.get("h1, h2").should("have.length.greaterThan", 0);
  });
});

// ─── Email Confirmed Page ─────────────────────────────────────────────────────

describe("Email Confirmed Page", () => {
  it("renders without crashing when visited directly", () => {
    cy.visit("/email-confirmed", { failOnStatusCode: false });
    cy.get("body").should("not.be.empty");
    cy.get("nav").should("exist");
  });
});

// ─── Unsubscribe Page ─────────────────────────────────────────────────────────

describe("Unsubscribe Page", () => {
  it("renders the unsubscribe page", () => {
    cy.visit("/unsubscribe");
    cy.get("body").should("not.be.empty");
    cy.get("nav").should("exist");
  });
});

// ─── Rate Booking Page (token-based) ─────────────────────────────────────────

describe("Rate Booking Page", () => {
  it("renders gracefully with a fake token (no crash)", () => {
    cy.visit("/rate-booking/fake-token-123", { failOnStatusCode: false });
    cy.get("body").should("not.be.empty");
    cy.get("nav").should("exist");
  });
});

// ─── Donation Page (linkId-based) ─────────────────────────────────────────────

describe("Donation Page", () => {
  it("renders gracefully with a fake linkId (no crash)", () => {
    cy.visit("/donate/fake-link-123", { failOnStatusCode: false });
    cy.get("body").should("not.be.empty");
    cy.get("nav").should("exist");
  });
});

// ─── Booking Success Page ─────────────────────────────────────────────────────

describe("Booking Success Page", () => {
  it("renders the booking-success page without crashing", () => {
    cy.visit("/booking-success", { failOnStatusCode: false });
    cy.get("body").should("not.be.empty");
    cy.get("nav").should("exist");
  });
});
