import { ASSIGNMENT_ERROR_CATEGORIES } from "./assignmentCategories";
import {
  buildAssignmentLLMRows,
  groupAssignmentErrors,
  writeAssignmentGroupedCSV,
  writeAssignmentLLMCSV,
} from "./assignmentGroupErrors";

const inputFile = "./data/assignment_test_failures.csv";
const outputFile = "./data/grouped_assignment_test_failures.csv";

console.log("🧪 Grouping assignment test failures...\n");

const grouped = groupAssignmentErrors(inputFile);

console.log("\n📊 🧠 Top Assignment Error Patterns:\n");

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

// Show top 10 in console
grouped.slice(0, 10).forEach((error, idx) => {
  const cat = categoryMap.get(error.error_category);
  const title = cat?.name || error.error_category;
  console.log(
    "------------------------------------------------------------------------",
  );
  console.log(
    `${idx + 1}. ${title} — ${error.occurrence_count} occurrences (${error.percentage})`,
  );
  console.log(`Summary: ${summarize(error.normalized_message)}`);
  const ex1 = formatExampleBlock(
    error.example_original_text,
    error.error_category,
  );
  const ex2 = formatExampleBlock(
    error.example_original_text_2,
    error.error_category,
  );
  if (ex1 || ex2) {
    console.log("Examples:");
    if (ex1) ex1.forEach((l) => console.log(`  • ${l}`));
    if (ex2) ex2.forEach((l) => console.log(`  • ${l}`));
  }
  if (cat?.studentFriendlyMessage)
    console.log(`Tip: ${cat.studentFriendlyMessage}`);
  console.log();
});

writeAssignmentGroupedCSV(grouped, outputFile);
console.log("\n✨ Done!");

// Also produce structured CSV for LLM hint generation
const llmRows = buildAssignmentLLMRows(inputFile);
writeAssignmentLLMCSV(
  llmRows,
  "./data/grouped_assignment_errors_structured.csv",
);
