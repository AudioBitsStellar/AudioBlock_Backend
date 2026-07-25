# Security Policy

## Vulnerability Scanning

Container images are automatically scanned for known vulnerabilities using [Trivy](https://github.com/aquasecurity/trivy) as part of the CI pipeline.

### Scan Targets

| Target       | Description                           |
| ------------ | ------------------------------------- |
| Base image   | `node:20` — the underlying OS/packages |
| Final image  | `audioblock-backend` — full app image   |

### Severity Thresholds

| Severity  | CI Behavior                                              |
| --------- | -------------------------------------------------------- |
| CRITICAL  | Blocks merge on push/PR (exit code 1)                    |
| HIGH      | Blocks merge on push/PR (exit code 1)                    |
| MEDIUM    | Reported in SARIF output, does not block                 |
| LOW        | Reported in SARIF output, does not block                 |

Scans run with `--ignore-unfixed` so only fixable vulnerabilities trigger failure.

### Schedule

- **Per-commit**: Scans run on every push and pull request to `main`.
- **Weekly full scan**: Monday at 06:00 UTC via scheduled workflow (results archived, no blocking).

### Accepting Vulnerabilities (`.trivyignore`)

To suppress a finding after review, add its CVE ID to `.trivyignore` at the repository root:

```
CVE-2023-1234  # Accepted: <justification>
```

Each entry **must** include a justification. Suppressed vulnerabilities are excluded from both blocking and SARIF reporting.

### PR Annotations

Scan results appear as inline annotations on PR diffs via [SARIF upload](https://docs.github.com/en/code-security/code-scanning/integrating-with-code-scanning/sarif-support-for-code-scanning). Critical/high findings in changed files are highlighted directly on the diff.

### Audit Trail

Scan results (SARIF files) are archived as build artifacts for 90 days.

### Exceptions

Any deviation from this policy requires approval from the security team. Document exceptions in `.trivyignore` with the `# Exception:` prefix.
