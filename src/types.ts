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
