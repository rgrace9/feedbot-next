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

interface ErrorGroup {
  fingerprint: string;
  categoryId: string;
  categoryName: string;
  testName: string;
  normalizedMessage: string;
  occurrences: number;
  submissionIds: Set<string>;
  examples: string[];
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

    const category =
      categorizeAssignmentError(core) || categorizeAssignmentError(normalized);
    const categoryId = category?.id || "unknown";
    const categoryName = category?.name || "Unknown Error";
    const testName = (record.name || "Unknown Test").trim();
    const fingerprint = createFingerprint(
      normalized,
      `${categoryId}::${testName}`,
    );

    if (!groups.has(fingerprint)) {
      groups.set(fingerprint, {
        fingerprint,
        categoryId,
        categoryName,
        testName,
        normalizedMessage: normalized,
        occurrences: 0,
        submissionIds: new Set<string>(),
        examples: [],
        assignmentContextCounts: new Map<string, number>(),
      });
    }
    const group = groups.get(fingerprint)!;
    group.occurrences++;
    if (record.grader_result_id)
      group.submissionIds.add(record.grader_result_id);
    if (group.examples.length < 2) group.examples.push(core);
    const part = (record.part || "").trim();
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
  const rows = grouped.map((g) => {
    const norm = (g.normalized_message || "").replace(/"/g, '""');
    const ex = (g.example_original_text || "").replace(/"/g, '""');
    return [
      g.error_id,
      g.error_category,
      `"${norm}"`,
      g.occurrence_count,
      g.unique_submissions,
      g.percentage,
      `"${ex}"`,
    ];
  });
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
  const content = readFileSync(csvPath, "utf-8");
  const records: AssignmentErrorRecord[] = parse(content, {
    columns: true,
    skip_empty_lines: true,
  });
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
    const fingerprint = createFingerprint(
      normalized,
      `${categoryId}::${testName}`,
    );
    if (!tmpGroups.has(fingerprint)) {
      tmpGroups.set(fingerprint, {
        fingerprint,
        categoryId,
        categoryName,
        testName,
        normalizedMessage: normalized,
        occurrences: 0,
        submissionIds: new Set<string>(),
        examples: [],
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
  }

  const rows: GroupedAssignmentLLMRow[] = [];
  for (const grp of tmpGroups.values()) {
    const testName = grp.testName;
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
    });
  }

  return rows;
}

export function writeAssignmentLLMCSV(
  rows: GroupedAssignmentLLMRow[],
  outputPath = "./data/grouped_assignment_errors_structured.csv",
): void {
  const headers = [
    "csvcategory",
    "test_name",
    "error_type",
    "count",
    "clean_error_text",
  ];

  const csvRows = rows.map((r) => {
    const csvcategory = `"${(r.errorCategory || "").replace(/"/g, '""')}"`;
    const test_name = `"${(r.testName || "").replace(/"/g, '""')}"`;
    const error_type = r.errorType || "";
    const count = (r.count ?? 0).toString();
    const clean_error_text = `"${(r.errorMessage || "").replace(/"/g, '""')}"`;
    return [csvcategory, test_name, error_type, count, clean_error_text].join(
      ",",
    );
  });

  const csv = [headers.join(","), ...csvRows].join("\n");
  writeFileSync(outputPath, csv);
  console.log(`\n🧾 Wrote structured LLM assignment errors to ${outputPath}`);
}
