import { parse } from "csv-parse/sync";
import { readFileSync, writeFileSync } from "fs";
import { categorizeError } from "./buildErrorCategories";
import {
  createFingerprint,
  extractCoreError,
  normalizeError,
} from "./extractBuildErrors";
import type { BuildErrorRecord, GroupedError } from "./types";

interface ErrorGroup {
  fingerprint: string;
  categoryId: string;
  categoryName: string;
  normalizedMessage: string;
  occurrences: number;
  submissionIds: Set<string>;
  examples: string[];
}

export function groupBuildErrors(csvPath: string): GroupedError[] {
  // Read CSV
  const content = readFileSync(csvPath, "utf-8");
  const records: BuildErrorRecord[] = parse(content, {
    columns: true,
    skip_empty_lines: true,
  });

  console.log(`Loaded ${records.length} build error records`);

  // Group errors
  const groups = new Map<string, ErrorGroup>();

  // Helper to get the error output text from varying CSV schemas
  const getOutputText = (record: any): string => {
    return (
      record.output ||
      record.test_output ||
      record.build_output ||
      record.stdout ||
      record.stderr ||
      ""
    );
  };

  for (const record of records) {
    // Extract core error
    const rawOutput = getOutputText(record);
    if (!rawOutput || typeof rawOutput !== "string") {
      // Skip records without output text
      continue;
    }

    const coreError = extractCoreError(rawOutput);
    // Normalize
    const normalized = normalizeError(coreError);

    // Categorize (try raw first, then normalized as fallback)
    let category = categorizeError(coreError);
    // Special-case: detect Java version mismatch anywhere in raw output
    if (!category) {
      const javaMismatchRaw =
        /UnsupportedClassVersionError/i.test(rawOutput) ||
        /unsupported class (?:file )?major version (?:\d+|x)/i.test(
          rawOutput,
        ) ||
        /has been compiled by a more recent version/i.test(rawOutput) ||
        /major\.minor version/i.test(rawOutput) ||
        /source (?:level|option) \d+ is no longer supported/i.test(rawOutput) ||
        /target (?:release|option) \d+ (?:is )?not supported/i.test(
          rawOutput,
        ) ||
        /invalid target release: \d+/i.test(rawOutput);
      if (javaMismatchRaw) {
        category = {
          id: "java_version_mismatch",
          name: "Java Version Incompatibility",
          patterns: [],
          description: "",
        } as any;
      }
    }
    if (!category) {
      category = categorizeError(normalized);
    }
    const categoryId = category?.id || "unknown";
    const categoryName = category?.name || "Unknown Error";

    // Create fingerprint
    const fingerprint = createFingerprint(normalized, categoryId);

    // Group
    if (!groups.has(fingerprint)) {
      groups.set(fingerprint, {
        fingerprint,
        categoryId,
        categoryName,
        normalizedMessage: normalized,
        occurrences: 0,
        submissionIds: new Set(),
        examples: [],
      });
    }

    const group = groups.get(fingerprint)!;
    group.occurrences++;
    if (record.grader_result_id) {
      group.submissionIds.add(record.grader_result_id);
    }

    // Keep up to 2 examples
    if (group.examples.length < 2) {
      group.examples.push(coreError);
    }
  }

  console.log(`Found ${groups.size} unique error patterns`);

  // Convert to output format
  const grouped: GroupedError[] = [];

  for (const group of groups.values()) {
    const percentage = ((group.occurrences / records.length) * 100).toFixed(1);

    grouped.push({
      error_id: 0, // assign after sorting
      error_category: group.categoryId,
      normalized_message: group.normalizedMessage,
      occurrence_count: group.occurrences,
      unique_submissions: group.submissionIds.size,
      percentage: `${percentage}%`,
      example_original_text: group.examples[0] || "",
      example_original_text_2: group.examples[1] || "",
    });
  }

  // Sort by occurrence count (most common first)
  grouped.sort((a, b) => b.occurrence_count - a.occurrence_count);

  // Assign sequential IDs after sorting
  grouped.forEach((g, idx) => {
    g.error_id = idx + 1;
  });

  return grouped;
}

export function writeGroupedCSV(
  grouped: GroupedError[],
  outputPath: string,
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
  console.log(`\n✅ ⌨️👩🏾‍💻🖥️💻Wrote grouped errors to ${outputPath}`);
}
