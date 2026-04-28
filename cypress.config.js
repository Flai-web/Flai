const { defineConfig } = require("cypress");

module.exports = defineConfig({
  e2e: {
    // specPattern must be at the e2e level, NOT inside setupNodeEvents
    specPattern: "cypress/e2e/**/*.cy.js",
    setupNodeEvents(on, config) {
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
