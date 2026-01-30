import { groupBuildErrors, writeGroupedCSV } from "./groupBuildErrors";

const inputFile = "./data/cyb1-grader-result-test-output-failures.csv";
const outputFile = "./data/grouped_build_errors.csv";

console.log("🏋🏾‍♀️ Grouping build errors... 🚀\n");

const grouped = groupBuildErrors(inputFile);

// Show top 10 in console
console.log("\n📊 🛑 Top 10 Error Patterns:\n");
grouped.slice(0, 10).forEach((error) => {
  console.log(
    `${error.error_id}. [${error.error_category}] ${error.occurrence_count} occurrences (${error.percentage})`,
  );
  console.log(`   ${error.normalized_message.substring(0, 80)}...`);
  console.log();
});
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
