export interface BuildErrorRecord {
  id: string;
  created_at: string;
  output: string;
  grader_result_id: string;
}

export interface GroupedError {
  error_id: number;
  error_category: string;
  normalized_message: string;
  occurrence_count: number;
  unique_submissions: number;
  percentage: string;
  example_original_text: string;
  example_original_text_2?: string;
}

export interface AssignmentErrorRecord {
  id: string;
  name?: string;
  part?: string;
  output?: string;
  test_output?: string;
  mutation_output?: string;
  stdout?: string;
  stderr?: string;
  grader_result_id?: string;
  score?: string;
  max_score?: string;
}

export interface GroupedAssignmentLLMRow {
  errorCategory: string; // e.g., "Unit Enum - Not Implemented"
  testName: string; // e.g., "Unit Enum"
  errorType: string; // e.g., "NOT_IMPLEMENTED"
  errorMessage: string; // cleaned plain text message
  assignmentContext?: string; // record.part or similar
  count?: number;
}
