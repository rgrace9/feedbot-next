export interface AssignmentErrorCategory {
  id: string;
  name: string;
  patterns: RegExp[];
  description: string;
  studentFriendlyMessage?: string;
}

export const ASSIGNMENT_ERROR_CATEGORIES: AssignmentErrorCategory[] = [
  {
    id: "not_implemented",
    name: "Not Implemented",
    patterns: [
      /Not yet implemented/i,
      /UnsupportedOperationException/i,
      /NotImplementedException/i,
      /fail\(.{0,80}Not yet implemented.{0,80}\)/i,
      /not yet been provided by the student/i,
    ],
    description: "Student has not provided an implementation yet",
    studentFriendlyMessage:
      "It looks like this part isn't implemented yet. Start by writing the method and running tests locally.",
  },
  {
    id: "dependency_not_met",
    name: "Dependency Not Met",
    patterns: [
      /Dependencies Not Met/i,
      /not graded because the following dependencies were not satisfied/i,
      /NoClassDefFoundError/i,
      /ClassNotFoundException/i,
      /Could not resolve dependency/i,
    ],
    description:
      "Grading skipped due to unmet prerequisite or missing dependency",
    studentFriendlyMessage:
      "A prerequisite failed or a dependency is missing. Fix the earlier unit or add the required dependency.",
  },
  {
    id: "mutation_testing_zero_faults",
    name: "Mutation Testing: Zero Faults",
    patterns: [
      /Faults detected:\s*0\b/i,
      /Mutation testing score:\s*0(?:\.0+)?%/i,
      /All mutants survived/i,
      /Killed mutants:\s*0\b/i,
      /Mutations killed:\s*0\b/i,
    ],
    description: "Tests did not catch any mutants",
    studentFriendlyMessage:
      "Your tests didn't catch any bugs. Add more assertions and edge cases to increase coverage.",
  },
  {
    id: "mutation_testing_partial",
    name: "Mutation Testing: Partial",
    patterns: [
      /Faults detected:\s*(?!0)\d+/i,
      /Faults detected:\s*(?!0)\d+\s*\/\s*\d+/i,
      /Mutation testing score:\s*(?!0(?:\.0+)?%)\d+(?:\.\d+)?%/i,
      /Survived mutants:\s*\d+/i,
    ],
    description: "Tests caught some mutants but not all",
    studentFriendlyMessage:
      "Good start! Some bugs were caught, but a few survived. Strengthen tests for remaining cases.",
  },
  {
    id: "test_compilation_failed",
    name: "Test Compilation Failed",
    patterns: [
      /Your tests failed to compile/i,
      /Tests failed to compile/i,
      /Failed to compile tests/i,
    ],
    description: "The test sources did not compile",
    studentFriendlyMessage:
      "Fix compilation errors in your test code or project setup before running tests.",
  },
  {
    id: "implementation_incomplete",
    name: "Implementation Incomplete",
    patterns: [/additional failing tests not shown/i],
    description:
      "There are additional failing tests indicating incomplete implementation",
    studentFriendlyMessage:
      "Some tests fail beyond what is shown. Continue implementing functionality and add tests for missing behavior.",
  },
  {
    id: "test_failure",
    name: "Test Failure",
    patterns: [
      /expected:<[^>]+>\s+but was:<[^>]+>/i,
      /AssertionError/i,
      /ComparisonFailure/i,
      /assert\s+.*\s+failed/i,
      /AssertionFailedError/i,
      /Tests passed:\s*\d+\s*\/\s*\d+[\s\S]*?(?:fail|failure|failed)/i,
    ],
    description: "A test failed with incorrect output or state",
    studentFriendlyMessage:
      "A test is failing. Compare expected vs actual values and trace the code path to fix the logic.",
  },
];

export function categorizeAssignmentError(
  errorMessage: string,
): AssignmentErrorCategory | null {
  for (const category of ASSIGNMENT_ERROR_CATEGORIES) {
    for (const pattern of category.patterns) {
      if (pattern.test(errorMessage)) return category;
    }
  }
  return null;
}
