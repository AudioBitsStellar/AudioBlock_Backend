#!/usr/bin/env node

/**
 * Circular dependency checker for AudioBlocks Backend
 *
 * Usage: node scripts/check-circular-deps.js
 *
 * This script analyzes the TypeScript codebase to detect circular dependencies
 * between modules. Circular dependencies can cause:
 * - Runtime errors (undefined imports)
 * - Hidden coupling between modules
 * - Difficult testing and maintenance
 *
 * Returns exit code 1 if circular dependencies found, 0 otherwise.
 */

const fs = require("fs");
const path = require("path");

const SRC_DIR = path.join(__dirname, "../src");
const IGNORE_DIRS = ["node_modules", ".git", "dist", "build"];

/**
 * Parse imports from a TypeScript file
 */
function parseImports(filePath) {
  const content = fs.readFileSync(filePath, "utf-8");
  const imports = [];

  // Match various import patterns
  const importRegex = /import\s+(?:{[^}]+}|[^'"]+)\s+from\s+['"]([^'"]+)['"]/g;
  const requireRegex = /require\s*\(['"]([^'"]+)['"]\)/g;

  let match;

  while ((match = importRegex.exec(content)) !== null) {
    imports.push(match[1]);
  }

  while ((match = requireRegex.exec(content)) !== null) {
    imports.push(match[1]);
  }

  return imports;
}

/**
 * Resolve import path to absolute path
 */
function resolveImportPath(fromFile, importPath) {
  if (!importPath.startsWith(".")) {
    // External module, ignore
    return null;
  }

  const fromDir = path.dirname(fromFile);
  let resolved = path.resolve(fromDir, importPath);

  // Try adding .ts extension
  if (!fs.existsSync(resolved) && !resolved.endsWith(".ts")) {
    if (fs.existsSync(resolved + ".ts")) {
      resolved += ".ts";
    } else if (fs.existsSync(path.join(resolved, "index.ts"))) {
      resolved = path.join(resolved, "index.ts");
    } else {
      return null;
    }
  }

  return resolved;
}

/**
 * Get all TypeScript files recursively
 */
function getAllTsFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);

  files.forEach((file) => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      if (!IGNORE_DIRS.includes(file)) {
        getAllTsFiles(filePath, fileList);
      }
    } else if (file.endsWith(".ts") && !file.endsWith(".d.ts")) {
      fileList.push(filePath);
    }
  });

  return fileList;
}

/**
 * Build dependency graph
 */
function buildDependencyGraph(files) {
  const graph = new Map();

  files.forEach((file) => {
    const imports = parseImports(file);
    const dependencies = [];

    imports.forEach((importPath) => {
      const resolved = resolveImportPath(file, importPath);
      if (resolved && files.includes(resolved)) {
        dependencies.push(resolved);
      }
    });

    graph.set(file, dependencies);
  });

  return graph;
}

/**
 * Detect circular dependencies using DFS
 */
function detectCircularDependencies(graph) {
  const visited = new Set();
  const recursionStack = new Set();
  const cycles = [];

  function dfs(node, path = []) {
    if (recursionStack.has(node)) {
      // Found a cycle
      const cycleStart = path.indexOf(node);
      const cycle = path.slice(cycleStart).concat(node);
      cycles.push(cycle);
      return;
    }

    if (visited.has(node)) {
      return;
    }

    visited.add(node);
    recursionStack.add(node);
    path.push(node);

    const dependencies = graph.get(node) || [];
    dependencies.forEach((dep) => {
      dfs(dep, [...path]);
    });

    recursionStack.delete(node);
  }

  graph.forEach((_, node) => {
    dfs(node);
  });

  return cycles;
}

/**
 * Format cycle for output
 */
function formatCycle(cycle) {
  return cycle.map((file) => path.relative(SRC_DIR, file)).join("\n  → ");
}

/**
 * Main function
 */
function main() {
  console.log("🔍 Checking for circular dependencies...\n");

  const files = getAllTsFiles(SRC_DIR);
  console.log(`📁 Found ${files.length} TypeScript files\n`);

  const graph = buildDependencyGraph(files);
  console.log(`🔗 Built dependency graph with ${graph.size} nodes\n`);

  const cycles = detectCircularDependencies(graph);

  if (cycles.length === 0) {
    console.log("✅ No circular dependencies found!\n");
    process.exit(0);
  } else {
    console.log(
      `❌ Found ${cycles.length} circular ${cycles.length === 1 ? "dependency" : "dependencies"}:\n`,
    );

    cycles.forEach((cycle, index) => {
      console.log(`Cycle #${index + 1}:`);
      console.log(`  ${formatCycle(cycle)}\n`);
    });

    console.log("💡 Fix circular dependencies by:");
    console.log("  1. Using the ServiceRegistry pattern");
    console.log("  2. Extracting shared logic to a new module");
    console.log("  3. Using dependency injection\n");
    console.log("See docs/ARCHITECTURE.md for more details.\n");

    process.exit(1);
  }
}

main();
