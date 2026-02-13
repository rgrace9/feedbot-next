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
    return row.error_type === "DEPENDENCY_NOT_MET";
  }
}
