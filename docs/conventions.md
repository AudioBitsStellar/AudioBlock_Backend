# Coding Conventions

This document outlines the coding standards for AudioBlock Backend. Following these standards helps maintain a consistent, readable, and maintainable codebase.

## 1. ESLint and Prettier
We use ESLint and Prettier to enforce code quality and formatting.
- **Formatting:** Prettier will automatically format code (e.g. 2 spaces, semi-colons, single quotes).
- **Linting:** ESLint is configured with strict TypeScript rules.
  - No explicit `any` types where possible.
  - No unused variables.
  - Prefer `const` over `let`.
  - Consistent returns in functions.
  
## 2. Code Complexity
We enforce thresholds to prevent functions and files from becoming unmanageable:
- **Max Cyclomatic Complexity:** 15 per function.
- **Max Lines per Function:** 50 lines.
- **Max Lines per File:** 300 lines.
- **Max Parameters:** 5 per function.

If a function or file exceeds these limits, it should be refactored into smaller, testable units.

## 3. General Best Practices
- **Naming Conventions:**
  - Use `camelCase` for variables and function names.
  - Use `PascalCase` for classes, interfaces, and types.
  - Use `UPPER_SNAKE_CASE` for global constants.
- **Type Safety:** Ensure strong typing; avoid implicit `any`.
- **Comments:** Comment only to explain *why* something is done, not *what* it is doing (unless the logic is highly complex).
