export const fetchAssignmentSpec = async (specUrl: string) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(specUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    const text = await response.text();
    const preview = text.slice(0, 80).replace(/\s+/g, " ");
    console.log(
      "visible",
      `FeedBot spec_url loaded, first chars: "${preview}..."`,
    );
    return text;
  } catch (err) {
    const isTimeout =
      (err instanceof Error && err.name === "AbortError") ||
      (typeof err === "object" &&
        err !== null &&
        "name" in err &&
        err.name === "AbortError");
    const reason = isTimeout
      ? "Timed out after 10 seconds"
      : err instanceof Error
        ? err.message
        : "Unknown error fetching spec_url";
    console.log(
      "visible",
      `FeedBot configuration error: could not fetch spec_url '${specUrl}': ${reason}. FeedBot will be disabled for this run.`,
    );
  } finally {
    clearTimeout(timeoutId);
  }
};

(async () => {
  const assignmentSpecUrl =
    "https://raw.githubusercontent.com/neu-pdi/cs3100-public-resources/refs/heads/main/assignments/cyb1-recipes.md";
  const res = await fetchAssignmentSpec(assignmentSpecUrl);
  console.log("\nFetched assignment spec content length:", res?.length);
})();
