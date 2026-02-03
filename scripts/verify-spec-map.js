#!/usr/bin/env node

/**
 * Verify spec-map.yaml coverage
 *
 * Checks that:
 * - All source files are mapped to at least one spec
 * - No stale paths exist (patterns that match no files)
 * - Reports coverage statistics
 *
 * Exit codes:
 *   0 - All checks pass
 *   1 - Issues found (unmapped files or stale paths)
 */

const fs = require('fs');
const path = require('path');

// Simple YAML parser for our specific format
function parseYaml(content) {
  const result = { version: null, specs: {}, global: { excluded_paths: [] } };
  // Handle Windows CRLF line endings
  const lines = content.split('\n').map(line => line.replace(/\r$/, ''));

  let currentSpec = null;
  let currentSource = null;
  let inSpecs = false;
  let inGlobal = false;
  let inExcludedPaths = false;
  let inSources = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip comments and empty lines
    if (trimmed.startsWith('#') || trimmed === '') continue;

    // Version
    if (trimmed.startsWith('version:')) {
      result.version = trimmed.split(':')[1].trim().replace(/"/g, '');
      continue;
    }

    // Top-level sections
    if (line === 'specs:') {
      inSpecs = true;
      inGlobal = false;
      continue;
    }

    if (line === 'global:') {
      inGlobal = true;
      inSpecs = false;
      currentSpec = null;
      continue;
    }

    // Global excluded paths
    if (inGlobal && trimmed === 'excluded_paths:') {
      inExcludedPaths = true;
      continue;
    }

    if (inExcludedPaths && trimmed.startsWith('- "')) {
      const pattern = trimmed.slice(3, -1); // Remove '- "' and '"'
      result.global.excluded_paths.push(pattern);
      continue;
    }

    // Spec names (2-space indent, word characters and hyphens, ends with colon)
    if (inSpecs && line.startsWith('  ') && !line.startsWith('    ')) {
      const match = line.match(/^  ([\w-]+):$/);
      if (match) {
        currentSpec = match[1];
        result.specs[currentSpec] = { description: '', sources: [] };
        inSources = false;
        currentSource = null;
        continue;
      }
    }

    // Spec properties (4-space indent)
    if (currentSpec && line.startsWith('    ') && !line.startsWith('      ')) {
      if (trimmed.startsWith('description:')) {
        result.specs[currentSpec].description = trimmed.split('description:')[1].trim().replace(/"/g, '');
        continue;
      }
      if (trimmed === 'sources:') {
        inSources = true;
        continue;
      }
    }

    // Source items (6-space indent with -)
    if (currentSpec && inSources && line.startsWith('      - ')) {
      if (trimmed.startsWith('- path:')) {
        const pathValue = trimmed.split('path:')[1].trim().replace(/"/g, '');
        currentSource = { path: pathValue, reason: '' };
        result.specs[currentSpec].sources.push(currentSource);
        continue;
      }
    }

    // Source reason (8-space indent)
    if (currentSource && line.startsWith('        ') && trimmed.startsWith('reason:')) {
      currentSource.reason = trimmed.split('reason:')[1].trim().replace(/"/g, '');
      continue;
    }
  }

  return result;
}

// Simple glob pattern matching
function matchGlob(pattern, filePath) {
  // Normalize path separators
  const normalizedPath = filePath.replace(/\\/g, '/');
  const normalizedPattern = pattern.replace(/\\/g, '/');

  // Convert glob to regex
  // Order matters: handle **/* first, then **, then *
  let regex = normalizedPattern
    .replace(/\./g, '\\.')           // Escape dots
    .replace(/\*\*\/\*/g, '.+')      // **/* matches one or more chars (at least one path segment)
    .replace(/\*\*/g, '.*')          // ** matches any chars including /
    .replace(/\*/g, '[^/]*');        // * matches chars except /

  regex = '^' + regex + '$';

  return new RegExp(regex).test(normalizedPath);
}

// Recursively get all files in directory
function getAllFiles(dir, baseDir = dir) {
  const files = [];

  if (!fs.existsSync(dir)) return files;

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, '/');

    if (entry.isDirectory()) {
      // Skip node_modules and dist early for performance
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') {
        continue;
      }
      files.push(...getAllFiles(fullPath, baseDir));
    } else {
      files.push(relativePath);
    }
  }

  return files;
}

// Check if a file matches any excluded pattern
function isExcluded(filePath, excludedPatterns) {
  return excludedPatterns.some(pattern => matchGlob(pattern, filePath));
}

// Main verification
function verify() {
  const rootDir = path.resolve(__dirname, '..');
  const specMapPath = path.join(rootDir, 'openspec', 'spec-map.yaml');

  console.log('Verifying spec-map.yaml...\n');

  // Check spec-map.yaml exists
  if (!fs.existsSync(specMapPath)) {
    console.error('ERROR: openspec/spec-map.yaml not found');
    process.exit(1);
  }

  // Parse YAML
  const content = fs.readFileSync(specMapPath, 'utf8');
  const specMap = parseYaml(content);

  console.log(`Version: ${specMap.version}`);
  console.log(`Specs defined: ${Object.keys(specMap.specs).length}`);
  console.log(`Excluded patterns: ${specMap.global.excluded_paths.length}\n`);

  // Get all source files (node_modules and dist already excluded in getAllFiles)
  const allFiles = getAllFiles(rootDir, rootDir);

  // Filter to relevant source files
  const sourceFiles = allFiles.filter(file => {
    // Skip excluded patterns
    if (isExcluded(file, specMap.global.excluded_paths)) return false;

    // Skip openspec directory itself
    if (file.startsWith('openspec/')) return false;

    // Skip hidden files and directories
    if (file.split('/').some(part => part.startsWith('.'))) return false;

    // Keep code files
    const ext = path.extname(file);
    const codeExtensions = ['.ts', '.js', '.sql'];
    const configFiles = ['playwright.config.js', 'tsconfig.json', 'package.json'];

    if (configFiles.includes(path.basename(file))) return true;
    if (codeExtensions.includes(ext)) return true;

    return false;
  });

  console.log(`Total source files found: ${sourceFiles.length}\n`);

  // Track coverage
  const fileCoverage = new Map(); // file -> Set of specs
  const stalePatterns = [];

  // Check each spec's patterns
  for (const [specName, spec] of Object.entries(specMap.specs)) {
    for (const source of spec.sources) {
      const pattern = source.path;
      const matchedFiles = sourceFiles.filter(file => matchGlob(pattern, file));

      if (matchedFiles.length === 0) {
        stalePatterns.push({ spec: specName, pattern, reason: source.reason });
      } else {
        for (const file of matchedFiles) {
          if (!fileCoverage.has(file)) {
            fileCoverage.set(file, new Set());
          }
          fileCoverage.get(file).add(specName);
        }
      }
    }
  }

  // Find unmapped files
  const unmappedFiles = sourceFiles.filter(file => !fileCoverage.has(file));

  // Report results
  let hasIssues = false;

  // Stale patterns
  if (stalePatterns.length > 0) {
    hasIssues = true;
    console.log('STALE PATTERNS (match no files):');
    for (const { spec, pattern, reason } of stalePatterns) {
      console.log(`  ${spec}: "${pattern}"`);
      console.log(`    Reason: ${reason}`);
    }
    console.log();
  }

  // Unmapped files
  if (unmappedFiles.length > 0) {
    hasIssues = true;
    console.log('UNMAPPED FILES:');
    for (const file of unmappedFiles) {
      console.log(`  ${file}`);
    }
    console.log();
  }

  // Coverage stats
  const coveredCount = fileCoverage.size;
  const totalCount = sourceFiles.length;
  const coveragePercent = totalCount > 0 ? ((coveredCount / totalCount) * 100).toFixed(1) : 0;

  console.log('COVERAGE SUMMARY:');
  console.log(`  Covered files: ${coveredCount}/${totalCount} (${coveragePercent}%)`);
  console.log(`  Unmapped files: ${unmappedFiles.length}`);
  console.log(`  Stale patterns: ${stalePatterns.length}`);
  console.log();

  // Spec coverage breakdown
  console.log('SPEC COVERAGE:');
  for (const specName of Object.keys(specMap.specs)) {
    const filesForSpec = [...fileCoverage.entries()]
      .filter(([file, specs]) => specs.has(specName))
      .map(([file]) => file);
    console.log(`  ${specName}: ${filesForSpec.length} files`);
  }
  console.log();

  if (hasIssues) {
    console.log('RESULT: Issues found - review unmapped files and stale patterns');
    process.exit(1);
  } else {
    console.log('RESULT: All checks passed');
    process.exit(0);
  }
}

verify();
