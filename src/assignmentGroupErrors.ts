import { parse } from "csv-parse/sync";
import { readFileSync, writeFileSync } from "fs";
import { categorizeAssignmentError } from "./assignmentCategories";
import {
  buildCleanErrorText,
  createFingerprint,
  extractAssignmentCore,
  normalizeAssignmentError,
} from "./assignmentExtract";
import type {
  AssignmentErrorRecord,
  GroupedAssignmentLLMRow,
  GroupedError,
} from "./types";

interface ErrorGroup {
  fingerprint: string;
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
const outputFile = "./data/grouped_assignment_test_failures.csv";

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

export function groupAssignmentErrors(csvPath = inputFile): GroupedError[] {
  const content = readFileSync(csvPath, "utf-8");
  const records: AssignmentErrorRecord[] = parse(content, {
    columns: true,
    skip_empty_lines: true,
  });
  console.log(`Loaded ${records.length} assignment error records`);

  const groups = new Map<string, ErrorGroup>();

  for (const record of records) {
    const raw = getOutputText(record);
    if (!raw || typeof raw !== "string") continue;

    const core = extractAssignmentCore(raw);
    const normalized = normalizeAssignmentError(core);

    let category =
      categorizeAssignmentError(core) || categorizeAssignmentError(normalized);
    const categoryId = category?.id || "unknown";
    const categoryName = category?.name || "Unknown Error";

    const fingerprint = createFingerprint(normalized, categoryId);

    if (!groups.has(fingerprint)) {
      groups.set(fingerprint, {
        fingerprint,
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
    const group = groups.get(fingerprint)!;
    group.occurrences++;
    if (record.grader_result_id)
      group.submissionIds.add(record.grader_result_id);
    if (group.examples.length < 2) group.examples.push(core);
    const testName = (record.name || "").trim();
    const part = (record.part || "").trim();
    if (testName)
      group.testNameCounts.set(
        testName,
        (group.testNameCounts.get(testName) || 0) + 1,
      );
    if (part)
      group.assignmentContextCounts.set(
        part,
        (group.assignmentContextCounts.get(part) || 0) + 1,
      );
  }

  console.log(`Found ${groups.size} unique assignment error patterns`);

  const grouped: GroupedError[] = [];
  for (const group of groups.values()) {
    const percentage = ((group.occurrences / records.length) * 100).toFixed(1);
    grouped.push({
      error_id: 0,
      error_category: group.categoryId,
      normalized_message: group.normalizedMessage,
      occurrence_count: group.occurrences,
      unique_submissions: group.submissionIds.size,
      percentage: `${percentage}%`,
      example_original_text: group.examples[0] || "",
      example_original_text_2: group.examples[1] || "",
    });
  }

  grouped.sort((a, b) => b.occurrence_count - a.occurrence_count);
  grouped.forEach((g, idx) => (g.error_id = idx + 1));
  return grouped;
}

export function writeAssignmentGroupedCSV(
  grouped: GroupedError[],
  outputPath = outputFile,
): void {
  const headers = [
    "error_id",
    "error_category",
    "normalized_message",
    "occurrence_count",
    "unique_submissions",
    "percentage",
    "example_original_text",
  ];
  const rows = grouped.map((g) => [
    g.error_id,
    g.error_category,
    `"${g.normalized_message.replace(/"/g, '""')}"`,
    g.occurrence_count,
    g.unique_submissions,
    g.percentage,
    `"${g.example_original_text.replace(/"/g, '""')}"`,
  ]);
  const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  writeFileSync(outputPath, csv);
  console.log(`\n✅ Wrote grouped assignment errors to ${outputPath}`);
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
  const grouped = groupAssignmentErrors(csvPath);
  // Reconstruct groups with metadata mode values
  const content = readFileSync(csvPath, "utf-8");
  const records: AssignmentErrorRecord[] = parse(content, {
    columns: true,
    skip_empty_lines: true,
  });
  const groupsMeta = new Map<string, ErrorGroup>();

  // Re-run to collect metadata maps identically
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
    const fingerprint = createFingerprint(normalized, categoryId);
    if (!tmpGroups.has(fingerprint)) {
      tmpGroups.set(fingerprint, {
        fingerprint,
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
    const testName = (record.name || "").trim();
    const part = (record.part || "").trim();
    if (testName)
      grp.testNameCounts.set(
        testName,
        (grp.testNameCounts.get(testName) || 0) + 1,
      );
    if (part)
      grp.assignmentContextCounts.set(
        part,
        (grp.assignmentContextCounts.get(part) || 0) + 1,
      );
  }

  const rows: GroupedAssignmentLLMRow[] = [];
  for (const grp of tmpGroups.values()) {
    const testName = getModeValue(grp.testNameCounts);
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
    });
  }

  return rows;
}

export function writeAssignmentLLMCSV(
  rows: GroupedAssignmentLLMRow[],
  outputPath = "./data/grouped_assignment_errors_structured.csv",
): void {
  const headers = [
    "Error Category",
    "Test Name",
    "Error Type",
    "Error Message",
    "Assignment Context",
  ];
  const csvRows = rows.map((r) => [
    `"${(r.errorCategory || "").replace(/"/g, '""')}"`,
    `"${(r.testName || "").replace(/"/g, '""')}"`,
    r.errorType,
    `"${(r.errorMessage || "").replace(/"/g, '""')}"`,
    `"${(r.assignmentContext || "").replace(/"/g, '""')}"`,
  ]);
  const csv = [headers.join(","), ...csvRows.map((r) => r.join(","))].join(
    "\n",
  );
  writeFileSync(outputPath, csv);
  console.log(`\n🧾 Wrote structured LLM assignment errors to ${outputPath}`);
}
