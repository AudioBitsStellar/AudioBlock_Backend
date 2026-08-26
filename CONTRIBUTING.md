# Contributing to AudioBlock Backend

Thank you for your interest in contributing to AudioBlock Backend! This document outlines the process for setting up your environment, our coding standards, and how to submit a Pull Request.

## Development Environment Setup

1. **Fork and clone the repository:**
   \`\`\`bash
   git clone https://github.com/YOUR_USERNAME/AudioBlock_Backend.git
   cd AudioBlock_Backend
   \`\`\`

2. **Install dependencies:**
   \`\`\`bash
   npm install
   \`\`\`

3. **Set up environment variables:**
   Copy the example environment file and configure it as needed.
   \`\`\`bash
   cp .env.example .env
   \`\`\`

4. **Run the development server:**
   \`\`\`bash
   npm run dev
   \`\`\`

## Coding Standards
Please refer to our [Coding Conventions](docs/conventions.md) document for detailed guidelines on how to format and structure your code. Our project uses ESLint and Prettier to enforce these standards. Run `npm run lint:fix` before submitting your code.

## Submitting a Pull Request
1. Create a branch named according to the feature or fix (e.g., `feature/add-new-endpoint`, `fix/issue-123`).
2. Ensure your commit messages are clear and descriptive.
3. Test your changes locally (`npm run test`).
4. Push your branch and open a Pull Request using our [PR Template](.github/PULL_REQUEST_TEMPLATE.md).

## Review Expectations
Reviewers will look for:
- Adherence to coding standards (no lint errors, complexity warnings addressed).
- Proper test coverage for new logic.
- Clear commit messages and a detailed PR description.

## Bug Reports and Feature Requests
Please use our issue templates when filing new issues:
- [Bug Report](.github/ISSUE_TEMPLATE/bug_report.md)
- [Feature Request](.github/ISSUE_TEMPLATE/feature_request.md)
