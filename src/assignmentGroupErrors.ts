import { parse } from "csv-parse/sync";
import { readFileSync, writeFileSync } from "fs";
import { categorizeAssignmentError } from "./assignmentCategories";
import {
  buildCleanErrorText,
  extractAssignmentCore,
  normalizeAssignmentError,
} from "./assignmentExtract";
import { computeFingerprintFromCanonicalKey } from "./extractBuildErrors";
import type { AssignmentErrorRecord, GroupedAssignmentLLMRow } from "./types";

// Extract and normalize assertion from a test failure message
function extractNormalizedAssertion(errorMsg: string): string {
  // First check for the generic "Your tests failed against instructor's solution"
  if (
    errorMsg.includes("Your tests failed against the instructor's solution")
  ) {
    // Still extract the actual assertion if present
    const match = errorMsg.match(
      /expected:\s*<([^>]+)>\s+but\s+was:\s*<([^>]+)>/i,
    );
    if (match) {
      let expected = match[1].replace(/\s+/g, " ").trim();
      let actual = match[2].replace(/\s+/g, " ").trim();

      // Normalize decimal formatting (1.0 -> 1, but keep 1.5)
      expected = expected.replace(/\b(\d+)\.0+\b/g, "$1");
      actual = actual.replace(/\b(\d+)\.0+\b/g, "$1");

      // Normalize scientific notation and very long numbers
      expected = expected
        .replace(/\d+\.\d+E\d+/gi, "LARGE_NUM")
        .replace(/\d{15,}/g, "LARGE_NUM");
      actual = actual
        .replace(/\d+\.\d+E\d+/gi, "LARGE_NUM")
        .replace(/\d{15,}/g, "LARGE_NUM");

      return `expected:<${expected}> but was:<${actual}>`;
    }
    // No specific assertion found, group all "tests failed" together
    return "tests_failed_against_instructor_solution";
  }

  // Try to find a line like: expected:<...> but was:<...>
  const match = errorMsg.match(
    /expected:\s*<([^>]+)>\s+but\s+was:\s*<([^>]+)>/i,
  );
  if (match) {
    let expected = match[1].replace(/\s+/g, " ").trim();
    let actual = match[2].replace(/\s+/g, " ").trim();

    // Normalize decimal formatting
    expected = expected.replace(/\b(\d+)\.0+\b/g, "$1");
    actual = actual.replace(/\b(\d+)\.0+\b/g, "$1");

    // Normalize scientific notation and very long numbers
    expected = expected
      .replace(/\d+\.\d+E\d+/gi, "LARGE_NUM")
      .replace(/\d{15,}/g, "LARGE_NUM");
    actual = actual
      .replace(/\d+\.\d+E\d+/gi, "LARGE_NUM")
      .replace(/\d{15,}/g, "LARGE_NUM");

    return `expected:<${expected}> but was:<${actual}>`;
  }

  // Check for specific test method failures (these should be grouped separately)
  const testMethodMatch = errorMsg.match(
    /app\.cookyourbooks\.domain\.(\w+Test)\.(\w+)/,
  );
  if (testMethodMatch) {
    return `test_method:${testMethodMatch[1]}.${testMethodMatch[2]}`;
  }

  // Fallback: try to find AssertionError line
  const lines = errorMsg.split("\n");
  const assertLine = lines.find(
    (l) =>
      l.includes("AssertionFailedError") &&
      !l.includes("at app//") &&
      !l.includes("at java."),
  );
  if (assertLine) {
    return assertLine
      .replace(/org\.opentest4j\.AssertionFailedError:\s*/i, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 150);
  }

  // Last resort: use first meaningful line
  const meaningfulLine = lines.find(
    (l) =>
      l.trim() &&
      !l.includes("at app//") &&
      !l.includes("at java.") &&
      !l.includes("Test failed:"),
  );
  if (meaningfulLine) {
    return meaningfulLine.replace(/\s+/g, " ").trim().slice(0, 100);
  }

  return "unknown_test_failure";
}

interface ErrorGroup {
  fingerprint: string;
  canonicalKey?: string;
  categoryId: string;
  categoryName: string;
  normalizedMessage: string;
  occurrences: number;
  submissionIds: Set<string>;
  examples: string[];
  testNameCounts: Map<string, number>;
  assignmentContextCounts: Map<string, number>;
}

const inputFile = "./data/assignment_test_failures.csv";

function getOutputText(record: any): string {
  return (
    record.output ||
    record.test_output ||
    record.mutation_output ||
    record.stdout ||
    record.stderr ||
    ""
  );
}

function getModeValue(counts: Map<string, number>): string {
  let best = "";
  let max = 0;
  for (const [key, val] of counts.entries()) {
    if (val > max) {
      max = val;
      best = key;
    }
  }
  return best;
}

export function buildAssignmentLLMRows(
  csvPath = inputFile,
): GroupedAssignmentLLMRow[] {
  const content = readFileSync(csvPath, "utf-8");
  const records: AssignmentErrorRecord[] = parse(content, {
    columns: true,
    skip_empty_lines: true,
  });
  const includeTestNameInFingerprint = true;
  const tmpGroups = new Map<string, ErrorGroup>();
  for (const record of records) {
    const raw = getOutputText(record);
    if (!raw || typeof raw !== "string") continue;
    const core = extractAssignmentCore(raw);
    const normalized = normalizeAssignmentError(core);
    const category =
      categorizeAssignmentError(core) || categorizeAssignmentError(normalized);
    const categoryId = category?.id || "unknown";
    const categoryName = category?.name || "Unknown Error";
    const testName = (record.name || "Unknown Test").trim();

    let canonicalKey: string;
    if (categoryId === "test_failure") {
      // Group by normalized assertion, not test name
      const assertion = extractNormalizedAssertion(core);
      canonicalKey = `${categoryId}::${assertion}`;
    } else {
      canonicalKey = `${categoryId}::${includeTestNameInFingerprint ? testName : ""}::${normalized}`;
    }
    const fingerprint = computeFingerprintFromCanonicalKey(canonicalKey);

    if (!tmpGroups.has(fingerprint)) {
      tmpGroups.set(fingerprint, {
        fingerprint,
        canonicalKey,
        categoryId,
        categoryName,
        normalizedMessage: normalized,
        occurrences: 0,
        submissionIds: new Set<string>(),
        examples: [],
        testNameCounts: new Map<string, number>(),
        assignmentContextCounts: new Map<string, number>(),
      });
    }
    const grp = tmpGroups.get(fingerprint)!;
    grp.occurrences++;
    if (grp.examples.length < 1) grp.examples.push(core);
    const part = (record.part || "").trim();
    if (part)
      grp.assignmentContextCounts.set(
        part,
        (grp.assignmentContextCounts.get(part) || 0) + 1,
      );
    if (testName)
      grp.testNameCounts.set(
        testName,
        (grp.testNameCounts.get(testName) || 0) + 1,
      );
  }

  const rows: GroupedAssignmentLLMRow[] = [];
  for (const grp of tmpGroups.values()) {
    const testName = getModeValue(grp.testNameCounts) || "";
    const assignmentContext = getModeValue(grp.assignmentContextCounts);
    const errorType = grp.categoryId.replace(/-/g, "_").toUpperCase();
    const errorCategoryName = testName
      ? `${testName} - ${grp.categoryName}`
      : grp.categoryName;
    const cleanText = buildCleanErrorText(
      grp.examples[0] || grp.normalizedMessage,
      testName,
      grp.categoryId,
    );
    rows.push({
      errorCategory: errorCategoryName,
      testName: testName || "",
      errorType,
      errorMessage: cleanText,
      assignmentContext: assignmentContext || "",
      count: grp.occurrences,
      fingerprint: grp.fingerprint,
      canonicalKey: grp.canonicalKey,
    });
  }

  return rows;
}

export function writeAssignmentLLMCSV(
  rows: GroupedAssignmentLLMRow[],
  outputPath = "./data/grouped_errors.csv",
): void {
  const headers = [
    "category",
    "test_name",
    "error_type",
    "count",
    "fingerprint",
    "canonical_key",
    "clean_error_text",
  ];

  const csvRows = rows.map((r) => {
    const csvcategory = `"${(r.errorCategory || "").replace(/"/g, '""')}"`;
    const test_name = `"${(r.testName || "").replace(/"/g, '""')}"`;
    const error_type = r.errorType || "";
    const count = (r.count ?? 0).toString();
    const fingerprint = r.fingerprint || "";
    const canonical_key = `"${(r.canonicalKey || "").replace(/"/g, '""')}"`;
    const clean_error_text = `"${(r.errorMessage || "").replace(/"/g, '""')}"`;
    return [
      csvcategory,
      test_name,
      error_type,
      count,
      fingerprint,
      canonical_key,
      clean_error_text,
    ].join(",");
  });

  const csv = [headers.join(","), ...csvRows].join("\n");
  writeFileSync(outputPath, csv);
  console.log(`\n🧾 Wrote structured LLM assignment errors to ${outputPath}`);
}
