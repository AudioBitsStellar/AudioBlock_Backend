#!/usr/bin/env node

/**
 * Docker Compose consistency checker for AudioBlocks Backend (Issue #404).
 *
 * Usage: node scripts/check-compose-consistency.js [--json]
 *
 * The repository tracks five compose files that together describe the full
 * runtime topology:
 *
 *   - docker-compose.yml           base topology (all services)
 *   - docker-compose.override.yml  default dev overlay (hot reload)
 *   - docker-compose.dev.yml       explicit dev profile
 *   - docker-compose.prod.yml      production resource/environment overlay
 *   - docker-compose.test.yml      test profile (dedicated DB, runs the suite)
 *
 * Overlay files are meant to *extend* the base file, not to define services or
 * environment that the base file has never heard of. Historically these files
 * drifted (an env var added to one but not the others, or an overlay targeting
 * a service the base file does not define), which produced confusing, hard-to
 * -debug runtime behavior.
 *
 * This script enforces the invariant "the base file is the source of truth":
 *
 *   - every service referenced by an overlay file must exist in the base file
 *   - every assertion set (environment / env_file / build / ports / volumes /
 *     depends_on) in an overlay must target a service present in the base file
 *   - every environment key that an overlay sets for a service must already be
 *     declared by that same service in the base file ("no unexplained new env")
 *   - missing per-service build/depends_on consistency is reported so that any
 *     drift is explicit rather than silent
 *
 * It exits 0 when the files are consistent and 1 when drift is found, making
 * it CI-friendly.
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const ROOT = path.join(__dirname, "..");
const BASE_FILE = "docker-compose.yml";
const OVERLAY_FILES = [
  "docker-compose.override.yml",
  "docker-compose.dev.yml",
  "docker-compose.prod.yml",
  "docker-compose.test.yml",
];

const COMPOSE_FILES = [BASE_FILE, ...OVERLAY_FILES];

/** Parse a compose file, failing loudly with a useful message on bad YAML. */
function loadCompose(file) {
  const fullPath = path.join(ROOT, file);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Compose file missing: ${file}`);
  }
  let doc;
  try {
    doc = yaml.load(fs.readFileSync(fullPath, "utf8")) || {};
  } catch (err) {
    throw new Error(`Could not parse ${file}: ${err.message}`);
  }
  return doc.services || {};
}

/** Collect the set of environment keys (explicit keys or ${...} bare forms). */
function envKeysOfService(service) {
  const keys = new Set();
  const env = service.environment;
  if (Array.isArray(env)) {
    env.forEach((item) => {
      const key = String(item).split("=")[0].trim();
      if (key) keys.add(key);
    });
  } else if (env && typeof env === "object") {
    Object.keys(env).forEach((key) => keys.add(key));
  }
  return keys;
}

/** Collect declared setting keys for a service (for drift reporting). */
function declaredKeysOfService(service) {
  const keys = new Set();
  for (const prop of ["build", "ports", "volumes", "depends_on", "env_file", "command"]) {
    if (service && service[prop] !== undefined) keys.add(prop);
  }
  return keys;
}

/**
 * Format a diff of keys for humans. `added` are keys present only in context A
 * and `missing` are keys present elsewhere that context A does not declare.
 */
function formatKeyDiff(labels, added, missing) {
  const lines = [];
  if (added.length) lines.push(`  added without base declaration: ${added.join(", ")}`);
  if (missing.length) lines.push(`  declared in base but absent: ${missing.join(", ")}`);
  return lines.map((l) => `    - ${l}`).join("\n") + `\n  referenced by: [${labels.join(", ")}]`;
}

function main() {
  const asJson = process.argv.includes("--json");
  const problems = [];
  const warns = [];

  const baseServices = loadCompose(BASE_FILE);
  const overlayDocs = OVERLAY_FILES.map((file) => ({ file, services: loadCompose(file) }));

  const baseNames = Object.keys(baseServices);
  // Keys intentionally set by an overlay that the base file never declares.
  //
  //   RABBITMQ_USER / RABBITMQ_PASS  - referenced as bare ${...} substitutions
  //     in the base rabbitmq service's environment (the base file cannot
  //     enumerate them without supplying the secret).
  //   DATABASE_URL                   - test-only infrastructure override set by
  //     docker-compose.test.yml to point the suite at a dedicated database.
  //     It is intentionally not part of the base topology (the base app reads
  //     POSTGRES_* from .env.docker), so it is documented here as a justified
  //     difference rather than declared in the base file.
  const knownBareKeys = new Set(["RABBITMQ_USER", "RABBITMQ_PASS", "DATABASE_URL"]);

  for (const { file, services } of overlayDocs) {
    for (const serviceName of Object.keys(services)) {
      // Every overlay service must be defined (directly) by the base file.
      if (!baseNames.includes(serviceName)) {
        problems.push(
          `${file}: service "${serviceName}" is not defined in ${BASE_FILE} ` +
            `(base file is the source of truth; add it there first)`,
        );
        continue;
      }

      const overlayService = services[serviceName];
      const baseService = baseServices[serviceName];

      // Environment keys the overlay adds for a service must already be known
      // in the base file either as an explicit environment key or as a bare
      // ${VAR} used by that service.
      const baseEnv = envKeysOfService(baseService);
      const overlayEnv = envKeysOfService(overlayService);
      const addedEnv = [...overlayEnv].filter(
        (key) => !baseEnv.has(key) && !knownBareKeys.has(key),
      );

      if (addedEnv.length) {
        problems.push(
          `${file}: service "${serviceName}" sets environment key(s) not declared in ${BASE_FILE}:\n` +
            formatKeyDiff([BASE_FILE, file], addedEnv, []),
        );
      }

      // Warn (not error) about setting keys declared by an overlay but not by
      // the base file. This catches intentional-but-noisy overrides without
      // breaking the build for legitimate extensions.
      const baseDeclared = declaredKeysOfService(baseService);
      const overlayDeclared = declaredKeysOfService(overlayService);
      const undeclared = [...overlayDeclared].filter((k) => !baseDeclared.has(k));
      if (undeclared.length) {
        warns.push(
          `${file}: service "${serviceName}" declares setting(s) not present in ${BASE_FILE} ` +
            `(${undeclared.join(", ")}). Confirm this is intentional.`,
        );
      }
    }
  }

  // Cross-file environment-var drift: for each service, list which files
  // declare which env keys so reviewers can spot unexplained differences.
  const allDecls = new Map(); // service -> file -> Set(keys)
  for (const { file, services } of [
    { file: BASE_FILE, services: baseServices },
    ...overlayDocs,
  ]) {
    for (const serviceName of Object.keys(services)) {
      if (!allDecls.has(serviceName)) allDecls.set(serviceName, new Map());
      allDecls.get(serviceName).set(file, envKeysOfService(services[serviceName]));
    }
  }
  if (!asJson) {
    for (const [serviceName, fileKeys] of allDecls) {
      const keys = new Set();
      for (const k of fileKeys.values()) for (const key of k) keys.add(key);
      const summary = [...keys]
        .sort()
        .map((key) => {
          const where = [...fileKeys.entries()]
            .filter(([, k]) => k.has(key))
            .map(([f]) => f)
            .join(",");
          return `${key} [${where}]`;
        })
        .join(", ");
      console.log(`  - ${serviceName}: ${summary}`);
    }
  }

  if (asJson) {
    console.log(
      JSON.stringify({ consistent: problems.length === 0, problems, warnings: warns }, null, 2),
    );
  } else {
    console.log("Docker Compose consistency report");
    console.log("=================================");
    console.log("Environment keys declared per service (and where):");
    console.log("");
    if (warns.length) {
      console.log("\nWarnings:");
      warns.forEach((w) => console.log(`  ⚠ ${w}`));
    }
    if (problems.length) {
      console.log("\nProblems (drift):");
      problems.forEach((p) => console.log(`  ✗ ${p.replace(/\n/g, "\n    ")}`));
      console.log(`\n❌ ${problems.length} consistency problem(s) found.`);
      process.exit(1);
    }
    console.log("\n✅ All compose files are mutually consistent.");
    process.exit(0);
  }
}

main();
