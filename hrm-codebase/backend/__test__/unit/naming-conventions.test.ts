import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

// Guardrail for the naming-convention refactor (2026-06): Firestore collection names
// are snake_case + plural, and telemetry event/span names are dot-separated snake_case.
// This scans the real source for string literals so a regression (e.g. re-introducing a
// kebab `weekly-report` collection or a `workday.close` event) fails CI deterministically.
//
// Scope notes:
//   - Only `.collection("literal")` names are checked. The dual-read migration fallback is
//     held behind a `LEGACY_*` constant (not a `.collection("...")` literal), so the old
//     kebab name is intentionally exempt while it is being phased out.
//   - HTTP route paths are NOT checked here — kebab-case is correct for URLs
//     (e.g. `/api/v1/work-days/close`). Only collection + event/span names must be snake_case.

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");

// Intentional singular collections kept as-is (see naming-convention decision: renaming the
// core auth collections is high-risk-low-reward; `global` is a counters partition doc-set).
const SINGULAR_ALLOWLIST = new Set(["admin", "global"]);

const SNAKE_CASE = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;
const DOT_SNAKE_CASE = /^[a-z0-9]+(_[a-z0-9]+)*(\.[a-z0-9]+(_[a-z0-9]+)*)*$/;

const COLLECTION_LITERAL = /\.collection\(\s*"([^"]+)"\s*\)/g;
const EVENT_OR_SPAN_LITERAL = /\b(?:eventName|spanName):\s*"([^"]+)"/g;

const listSourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      return listSourceFiles(fullPath);
    }
    return fullPath.endsWith(".ts") ? [fullPath] : [];
  });

const collectLiterals = (pattern: RegExp): Map<string, string[]> => {
  const found = new Map<string, string[]>();

  for (const file of listSourceFiles(SRC_DIR)) {
    const content = readFileSync(file, "utf8");
    for (const match of content.matchAll(pattern)) {
      const value = match[1]!;
      const sources = found.get(value) ?? [];
      sources.push(file);
      found.set(value, sources);
    }
  }

  return found;
};

describe("naming conventions: firestore collections", () => {
  const collections = collectLiterals(COLLECTION_LITERAL);

  it("finds collection literals to validate", () => {
    expect(collections.size).toBeGreaterThan(0);
  });

  it("every collection name is snake_case (no kebab, no camelCase)", () => {
    const offenders = [...collections.keys()].filter((name) => !SNAKE_CASE.test(name));
    expect(offenders, `non-snake_case collection literals: ${offenders.join(", ")}`).toEqual([]);
  });

  it("every collection name is plural unless an intentional singular", () => {
    const offenders = [...collections.keys()].filter(
      (name) => !SINGULAR_ALLOWLIST.has(name) && !name.endsWith("s"),
    );
    expect(
      offenders,
      `non-plural collection literals (add to SINGULAR_ALLOWLIST if intentional): ${offenders.join(", ")}`,
    ).toEqual([]);
  });
});

describe("naming conventions: telemetry event/span names", () => {
  const events = collectLiterals(EVENT_OR_SPAN_LITERAL);

  it("finds event/span literals to validate", () => {
    expect(events.size).toBeGreaterThan(0);
  });

  it("every event/span name is dot-separated snake_case (no kebab)", () => {
    const offenders = [...events.keys()].filter((name) => !DOT_SNAKE_CASE.test(name));
    expect(offenders, `non-snake event/span literals: ${offenders.join(", ")}`).toEqual([]);
  });
});
