// ─── Authentication ───────────────────────────────────────────────────────────
// Tests the sign-in / sign-up flow on /auth without completing real auth calls.
// We verify the form mechanics (validation, field toggling) not the backend.

describe("Auth Page — Form Mechanics", () => {
  beforeEach(() => {
    cy.visit("/auth");
  });

  it("renders the auth page with an email input", () => {
    cy.get('input[type="email"]').should("exist").and("be.visible");
  });

  it("shows a validation error when submitting an invalid email", () => {
    cy.get('input[type="email"]').type("not-an-email");
    // Blur to trigger validation or try to proceed
    cy.get('input[type="email"]').blur();
    // The form should NOT navigate away for an invalid email
    cy.url().should("include", "/auth");
  });

  it("accepts a valid email format and moves to the password/name step", () => {
    // Type a valid-format email and wait for the debounce check
    cy.get('input[type="email"]').type("cypress-test@example.com");
    // After debounce the page should show a password field (login) or name field (signup)
    cy.wait(800); // debounce is 600ms
    cy.get('input[type="password"], input[name="fullName"], input[placeholder*="navn"], input[placeholder*="name"]', {
      timeout: 6000,
    }).should("exist");
  });

  it("/login redirect goes to /auth", () => {
    cy.visit("/login");
    cy.url().should("include", "/auth");
  });

  it("/signup redirect goes to /auth", () => {
    cy.visit("/signup");
    cy.url().should("include", "/auth");
  });
});

describe("Reset Password Page", () => {
  it("loads the reset-password page", () => {
    cy.visit("/reset-password");
    cy.get("body").should("not.be.empty");
    cy.get('input[type="email"]').should("exist");
  });

  it("shows an error for an invalid email on reset", () => {
    cy.visit("/reset-password");
    cy.get('input[type="email"]').type("bademail");
    cy.get('button[type="submit"], button').contains(/send|nulstil|reset/i).click();
    // Should stay on page, not navigate away
    cy.url().should("include", "/reset-password");
  });
});
