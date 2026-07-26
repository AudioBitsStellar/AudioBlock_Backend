/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src", "<rootDir>/tests"],
  testMatch: ["**/__tests__/**/*.test.ts", "**/tests/**/*.test.ts"],
  moduleNameMapper: {
    "^reflect-metadata$": "<rootDir>/node_modules/reflect-metadata",
  },
};
