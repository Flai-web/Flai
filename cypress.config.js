const { defineConfig } = require("cypress");

module.exports = defineConfig({
  e2e: {
    setupNodeEvents(on, config) {
      // ADD THIS LINE: It tells Cypress to look for your .cy.js files
    specPattern: 'cypress/e2e/**/*.cy.js', 
      // implement node event listeners here
    },
    // The Netlify plugin will automatically override this
    // with your live Deploy Preview URL
    baseUrl: "http://localhost:8888",
    viewportWidth: 1280,
    viewportHeight: 720,
    defaultCommandTimeout: 10000,
    video: false,
  },
});
