/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src", "<rootDir>/tests"],
  testMatch: ["**/__tests__/**/*.test.ts", "**/*.test.ts"],
  moduleNameMapper: {
    "^reflect-metadata$": "<rootDir>/node_modules/reflect-metadata",
  },
  // Coverage collection — run with `npm run test:coverage` (#396).
  // CI fails when any metric drops below these thresholds.
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/index.ts",
    "!src/migrations/**",
    "!src/seeders/**",
  ],
  coverageThreshold: {
    global: {
      lines: 50,
      functions: 50,
      branches: 40,
      statements: 50,
    },
  },
};
