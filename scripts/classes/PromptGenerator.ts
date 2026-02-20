import {
  BASE_PROMPT,
  CHECKLIST_STRATEGY_PROMPT,
  CONCEPT_ORIENTED_PROMPT,
  REFLECTION_PROMPT,
  TEST_DESIGN_PROMPT,
  TIERED_SPECIFIC_0_PROMPT,
  TIERED_SPECIFIC_1_PROMPT,
  TIERED_SPECIFIC_2_PROMPT,
} from "../../constants/promptData.js";

export interface EvaluationRow {
  category: string;
  test_name: string;
  error_type: string;
  count: string;
  fingerprint: string;
  canonical_key: string;
  clean_error_text: string;
}

/**
 * Generates prompts based on evaluation data and prompt variations
 */
export class PromptGenerator {
  private readonly assignmentUrl: string;
  private static readonly DEPENDENCY_NOT_GRADED_PATTERN =
    /This unit was not graded because the following dependencies were not satisfied/i;
  private static readonly SCORE_THRESHOLD_PATTERN =
    /Please meet the required score thresholds shown above before this unit will be graded/i;
  private static readonly FAULTS_ZERO_OF_FIVE_PATTERN =
    /Faults detected:\s*0\s*\/\s*5/i;
  private static readonly HIDDEN_HINTS_LIMIT_PATTERN =
    /\d+\s+additional hints available but not shown\.[\s\S]*You are limited to 1 hint total/i;
  private static readonly INSTRUCTOR_CATEGORY_PATTERN =
    /instructor[_\s-]?test[_\s-]?failure/i;
  private static readonly INSTRUCTOR_NO_DETAIL_SIGNALS = [
    /additional failing tests not shown/i,
    /hints?\s+available\s+but\s+not\s+shown/i,
    /tests passed:\s*\d+\s*\/\s*\d+/i,
  ];
  private static readonly INSTRUCTOR_ACTIONABLE_DETAIL_SIGNALS = [
    /org\.opentest4j\.AssertionFailedError/i,
    /AssertionFailedError/i,
    /expected:\s*</i,
    /but was:\s*</i,
    /\bat\s+app\/\//i,
    /\bat\s+[\w.$]+\([^)]*:\d+\)/i,
    /\b(?:NullPointerException|IllegalArgumentException|RuntimeException|Exception)\b/i,
  ];

  constructor(
    assignmentUrl: string = "https://neu-pdi.github.io/cs3100-public-resources/assignments/cyb1-recipes",
  ) {
    this.assignmentUrl = assignmentUrl;
  }

  /**
   * Generate a prompt for a specific row and prompt variation
   */
  generate(row: EvaluationRow, promptVariation: string): string {
    let basePrompt = BASE_PROMPT;

    // Add variation-specific modifications
    basePrompt += this.getPromptVariationContent(promptVariation);

    // Add context-specific information
    basePrompt += this.formatRowContext(row);

    return basePrompt;
  }

  /**
   * Get the content for a specific prompt variation
   */
  private getPromptVariationContent(promptVariation: string): string {
    switch (promptVariation) {
      case "concept-oriented":
        return CONCEPT_ORIENTED_PROMPT;

      case "test-design":
        return TEST_DESIGN_PROMPT;

      case "checklist-strategy":
        return CHECKLIST_STRATEGY_PROMPT;

      case "reflection-prompting":
        return REFLECTION_PROMPT;

      case "tiered-specific-0":
        return TIERED_SPECIFIC_0_PROMPT;

      case "tiered-specific-1":
        return TIERED_SPECIFIC_1_PROMPT;

      case "tiered-specific-2":
        return TIERED_SPECIFIC_2_PROMPT;

      default:
        // Return empty string for unrecognized variations (base prompt only)
        return "";
    }
  }

  /**
   * Format row context information for the prompt
   */
  private formatRowContext(row: EvaluationRow): string {
    return `
This is the assignment the student is working on: ${this.assignmentUrl}

Category: ${row.category}
Test Name: ${row.test_name}
LOG:
${row.clean_error_text}`;
  }

  /**
   * Check if a row should be skipped
   */
  shouldSkipRow(row: EvaluationRow): boolean {
    return this.getSkipReason(row) !== null;
  }

  /**
   * Get the reason a row should be skipped, or null if it should be processed
   */
  getSkipReason(row: EvaluationRow): string | null {
    const text = row.clean_error_text ?? "";
    const combinedText = `${row.category}\n${row.error_type}\n${row.canonical_key}\n${text}`;

    if (row.error_type === "DEPENDENCY_NOT_MET") {
      return "DEPENDENCY_NOT_MET category";
    }

    if (PromptGenerator.DEPENDENCY_NOT_GRADED_PATTERN.test(combinedText)) {
      return "Dependency gating system message";
    }

    if (PromptGenerator.SCORE_THRESHOLD_PATTERN.test(combinedText)) {
      return "Score-threshold gating system message";
    }

    if (
      PromptGenerator.FAULTS_ZERO_OF_FIVE_PATTERN.test(combinedText) &&
      PromptGenerator.HIDDEN_HINTS_LIMIT_PATTERN.test(combinedText)
    ) {
      return "Mutation 0/5 with hidden hints";
    }

    if (this.shouldSkipInstructorNoDetail(row, combinedText)) {
      return "Instructor failure without actionable detail";
    }

    return null;
  }

  private shouldSkipInstructorNoDetail(
    row: EvaluationRow,
    combinedText: string,
  ): boolean {
    const isInstructorRelated =
      row.error_type === "INSTRUCTOR_TEST_FAILURE" ||
      PromptGenerator.INSTRUCTOR_CATEGORY_PATTERN.test(combinedText);

    if (!isInstructorRelated) {
      return false;
    }

    const hasActionableDetail =
      PromptGenerator.INSTRUCTOR_ACTIONABLE_DETAIL_SIGNALS.some((pattern) =>
        pattern.test(combinedText),
      );

    if (hasActionableDetail) {
      return false;
    }

    return PromptGenerator.INSTRUCTOR_NO_DETAIL_SIGNALS.some((pattern) =>
      pattern.test(combinedText),
    );
  }
}
