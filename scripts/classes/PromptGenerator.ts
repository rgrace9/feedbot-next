import { createHash } from "crypto";
import {
  BASE_PROMPT,
  CHAIN_OF_THOUGHT_PROMPT,
  CHECKLIST_STRATEGY_PROMPT,
  DESIGN_RECIPE_FOCUSED_PROMPT,
} from "../../constants/promptData.js";

export interface EvaluationRow {
  name: string;
  score: string;
  max_score: string;
  output: string;
  is_active: boolean;
  title: string;
  profile_id: string;
  id: string;
  part: string;
  grader_result_id: string;
  fingerprint: string;
}

export interface RawEvaluationRow {
  [key: string]: unknown;
}

/** Every dataset must include these; other columns are optional. */
export const REQUIRED_DATASET_COLUMNS = [
  "name",
  "score",
  "max_score",
  "output",
] as const;

function toText(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function toBoolean(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  const normalized = toText(value).trim().toLowerCase();
  return ["true", "1", "yes", "y"].includes(normalized);
}

function buildFingerprint(row: {
  profile_id: string;
  title: string;
  name: string;
  output: string;
  id: string;
  part: string;
  grader_result_id: string;
}): string {
  let source: string;
  if (row.grader_result_id) {
    source = [row.grader_result_id, row.name, row.output].join("||");
  } else if (row.id) {
    source = [row.id, row.part, row.name, row.output].join("||");
  } else {
    source = [row.profile_id, row.title, row.name, row.output].join("||");
  }
  return createHash("sha256").update(source).digest("hex");
}

export function normalizeEvaluationRow(
  rawRow: RawEvaluationRow,
): EvaluationRow {
  const isActive =
    "is_active" in rawRow ? toBoolean(rawRow.is_active) : true;

  const row = {
    name: toText(rawRow.name).trim(),
    score: toText(rawRow.score).trim(),
    max_score: toText(rawRow.max_score).trim(),
    output: toText(rawRow.output).trim(),
    is_active: isActive,
    title: toText(rawRow.title).trim(),
    profile_id: toText(rawRow.profile_id).trim(),
    id: toText(rawRow.id).trim(),
    part: toText(rawRow.part).trim(),
    grader_result_id: toText(rawRow.grader_result_id).trim(),
  };

  return {
    ...row,
    fingerprint: buildFingerprint(row),
  };
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
      case "checklist-strategy":
        return CHECKLIST_STRATEGY_PROMPT;

      case "chain-of-thought":
        return CHAIN_OF_THOUGHT_PROMPT;

      case "design-recipe-focused":
        return DESIGN_RECIPE_FOCUSED_PROMPT;

      default:
        return BASE_PROMPT;
    }
  }

  /**
   * Format row context information for the prompt
   */
  private formatRowContext(row: EvaluationRow): string {
    return `
This is the assignment the student is working on: ${this.assignmentUrl}

Assignment Title: ${row.title}
Prompt: ${row.name}
Score: ${row.score}/${row.max_score}
LOG:
${row.output}`;
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
    if (!row.is_active) {
      return "inactive row";
    }

    const text = row.output ?? "";
    const combinedText = `${row.title}\n${row.name}\n${text}`;

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

    return null;
  }
}
