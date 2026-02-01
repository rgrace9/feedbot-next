import { BUILD_ERROR_CATEGORIES } from "./buildErrorCategories";
import { groupBuildErrors, writeGroupedCSV } from "./groupBuildErrors";

const inputFile = "./data/cyb1-grader-result-test-output-failures.csv";
const outputFile = "./data/grouped_build_errors.csv";

console.log("🏋🏾‍♀️ Grouping build errors... 🚀\n");

const grouped = groupBuildErrors(inputFile);

// Show top 10 in console
console.log("\n📊 🛑 Top 10 Error Patterns:\n");

const categoryMap = new Map(BUILD_ERROR_CATEGORIES.map((c) => [c.id, c]));

function summarize(text: string, max = 200) {
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}

function extractFocusedLines(
  example: string,
  focus: RegExp,
  before = 1,
  after = 3,
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

  // Category-focused extraction
  if (categoryId === "nullability_error") {
    const focused = extractFocusedLines(example, /NullAway/i, 1, 5);
    if (focused && focused.length) {
      return focused.map((l) => l.slice(0, 240));
    }
  }
  if (categoryId === "checkstyle_violation") {
    const focused =
      extractFocusedLines(example, /Checkstyle|violation/i, 0, 8) ||
      extractFocusedLines(
        example,
        /Execution failed for task ':[^']*checkstyle/i,
        0,
        8,
      );
    if (focused && focused.length) {
      return focused.map((l) => l.slice(0, 240));
    }
  }

  // Default: show more context (up to 8 lines)
  const lines = example
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 8)
    .map((l) => l.slice(0, 240));
  return lines.length ? lines : null;
}

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

  if (cat?.studentFriendlyMessage) {
    console.log(`Tip: ${cat.studentFriendlyMessage}`);
  }
  console.log();
});

// Always surface Java version incompatibilities, even if not in top 10
const javaVersionGroups = grouped.filter(
  (g) => g.error_category === "java_version_mismatch",
);
if (javaVersionGroups.length) {
  console.log(
    "------------------------------------------------------------------------",
  );
  console.log("Java Version Issues (always shown):\n");
  javaVersionGroups.slice(0, 5).forEach((g) => {
    const cat = categoryMap.get(g.error_category);
    const title = cat?.name || g.error_category;
    console.log(
      `• ${title} — ${g.occurrence_count} occurrences (${g.percentage})`,
    );
    const ex = formatExampleBlock(g.example_original_text, g.error_category);
    if (ex) ex.forEach((l) => console.log(`   ${l}`));
    if (cat?.studentFriendlyMessage) {
      console.log(`   Tip: ${cat.studentFriendlyMessage}`);
    }
    console.log();
  });
}
// Show all errors in console
// console.log("\n📊 🛑 Error Patterns:\n");
// grouped.forEach((error) => {
//   console.log(
//     `${error.error_id}. [${error.error_category}] ${error.occurrence_count} occurrences (${error.percentage})`,
//   );
//   console.log(`   ${error.normalized_message.substring(0, 80)}...`);
//   console.log();
// });

// Write to CSV
writeGroupedCSV(grouped, outputFile);

console.log("\n✨ Done!");
