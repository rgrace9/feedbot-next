import { ASSIGNMENT_ERROR_CATEGORIES } from "./assignmentCategories";
import {
  buildAssignmentLLMRows,
  writeAssignmentLLMCSV,
} from "./assignmentGroupErrors";

const inputFile = "./data/assignment_test_failures.csv";

// Read raw data to get total count
import { parse } from "csv-parse/sync";
import { readFileSync } from "fs";
const rawContent = readFileSync(inputFile, "utf-8");
const rawRecords = parse(rawContent, { columns: true, skip_empty_lines: true });
const totalErrors = rawRecords.length;

console.log("🧪 Grouping assignment test failures...\n");

const llmRows = buildAssignmentLLMRows(inputFile);
const uniquePatterns = llmRows.length;

// Calculate reduction
const reductionPercent = ((1 - uniquePatterns / totalErrors) * 100).toFixed(1);

console.log("📊 GROUPING STATISTICS:");
console.log(`   Total error records: ${totalErrors.toLocaleString()}`);
console.log(`   Unique patterns found: ${uniquePatterns.toLocaleString()}`);
console.log(
  `   Reduction: ${reductionPercent}% (${(totalErrors - uniquePatterns).toLocaleString()} fewer LLM calls needed)\n`,
);

// Count test failures specifically
const testFailureCount = llmRows.filter(
  (r) => r.errorType === "TEST_FAILURE",
).length;
const testFailureTotal = llmRows
  .filter((r) => r.errorType === "TEST_FAILURE")
  .reduce((sum, r) => sum + (r.count || 0), 0);
console.log("🎯 TEST FAILURE GROUPING:");
console.log(
  `   ${testFailureTotal.toLocaleString()} test failure errors → ${testFailureCount} unique patterns`,
);
console.log(`   Each pattern will get a custom LLM-generated hint\n`);

console.log("\n📊 🧠 Top Assignment Error Patterns by Category and Test:\n");

const categoryMap = new Map(ASSIGNMENT_ERROR_CATEGORIES.map((c) => [c.id, c]));

function summarize(text: string, max = 200) {
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}

function extractFocusedLines(
  example: string,
  focus: RegExp,
  before = 0,
  after = 4,
) {
  const lines = example.split("\n");
  const idx = lines.findIndex((l) => focus.test(l));
  if (idx === -1) return null;
  const start = Math.max(0, idx - before);
  const end = Math.min(lines.length, idx + 1 + after);
  return lines
    .slice(start, end)
    .map((l) => l.trim())
    .filter(Boolean);
}

function formatExampleBlock(example?: string, categoryId?: string) {
  if (!example) return null;
  if (categoryId === "test_failure") {
    const focused = extractFocusedLines(
      example,
      /expected:<|AssertionError|ComparisonFailure/i,
      1,
      5,
    );
    if (focused && focused.length) return focused.map((l) => l.slice(0, 240));
  }
  if (categoryId?.startsWith("mutation_testing")) {
    const focused = extractFocusedLines(
      example,
      /Faults detected|Mutation testing score|Survived mutants/i,
      0,
      8,
    );
    if (focused && focused.length) return focused.map((l) => l.slice(0, 240));
  }
  if (categoryId === "dependency_not_met") {
    const focused = extractFocusedLines(
      example,
      /Dependencies Not Met|not graded because/i,
      0,
      8,
    );
    if (focused && focused.length) return focused.map((l) => l.slice(0, 240));
  }
  return example
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 8)
    .map((l) => l.slice(0, 240));
}

// Show top 10 in console (based on grouped LLM rows)
llmRows
  .slice()
  .sort((a, b) => (b.count || 0) - (a.count || 0))
  .slice(0, 10)
  .forEach((row, idx) => {
    const title = row.errorCategory || row.errorType || "Unknown";
    console.log(
      "------------------------------------------------------------------------",
    );
    console.log(`${idx + 1}. ${title} — ${row.count || 0} occurrences`);
    console.log(`Summary: ${summarize(row.errorMessage || "")}`);
    if (row.assignmentContext) console.log(`Context: ${row.assignmentContext}`);
    console.log();
  });

// Write structured CSV for LLM hint generation
writeAssignmentLLMCSV(llmRows);

// Show category breakdown with test failure improvement
console.log("\n📈 CATEGORY BREAKDOWN:");
const categoryStats = new Map<string, { unique: number; total: number }>();
llmRows.forEach((row) => {
  const cat = row.errorType;
  if (!categoryStats.has(cat)) {
    categoryStats.set(cat, { unique: 0, total: 0 });
  }
  const stats = categoryStats.get(cat)!;
  stats.unique++;
  stats.total += row.count || 0;
});

// Sort by total errors
const sortedCats = Array.from(categoryStats.entries()).sort(
  (a, b) => b[1].total - a[1].total,
);

sortedCats.forEach(([cat, stats]) => {
  const avgPerPattern = (stats.total / stats.unique).toFixed(1);
  console.log(`   ${cat}:`);
  console.log(
    `      ${stats.total.toLocaleString()} errors → ${stats.unique} unique patterns (avg ${avgPerPattern} errors/pattern)`,
  );
});

console.log("\n✨ Done!");

// Revised daily update: summarize by category → test name subgroups
const byCategory = new Map<
  string,
  { name: string; tests: Map<string, number> }
>();
llmRows.forEach((row) => {
  const cat = ASSIGNMENT_ERROR_CATEGORIES.find(
    (c) => c.id.replace(/-/g, "_").toUpperCase() === row.errorType,
  );
  const catName = cat?.name || row.errorType;
  const key = row.errorType;
  if (!byCategory.has(key))
    byCategory.set(key, { name: catName, tests: new Map() });
  const entry = byCategory.get(key)!;
  const tn = row.testName || "Unknown Test";
  entry.tests.set(tn, (entry.tests.get(tn) || 0) + (row.count || 0));
});

console.log(
  "\nErrors are grouped by category, then by test name. For example, 'Dependency Not Met' has 5 subgroups (one per test), 'Mutation Testing' has 5 subgroups, etc. This allows generating specific hints like 'Fix your MeasuredIngredient tests' rather than generic 'Fix your tests'.\n",
);
for (const { name, tests } of byCategory.values()) {
  const topTests = Array.from(tests.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  console.log(`${name}:`);
  topTests.forEach(([t, n]) => console.log(`  - ${t} (${n} errors)`));
  console.log();
}
