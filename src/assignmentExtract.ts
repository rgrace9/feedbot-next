import { createFingerprint } from "./extractBuildErrors";

export function extractAssignmentCore(output: string): string {
  const lines = output.split("\n");
  if (!lines.length) return "";

  // Prefer dependency not met blocks
  for (let i = 0; i < lines.length; i++) {
    const li = lines[i] ?? "";
    if (/Dependencies Not Met/i.test(li) || /not graded because/i.test(li)) {
      const block: string[] = [];
      for (let j = i; j < Math.min(i + 30, lines.length); j++) {
        const line = lines[j];
        if (!line) break;
        if (/^\s*$/.test(line)) break;
        block.push(line.trim());
      }
      return block.join("\n").trim();
    }
  }

  // Prefer mutation testing summary blocks
  for (let i = 0; i < lines.length; i++) {
    const li = lines[i] ?? "";
    if (/Mutation testing|Faults detected|Mutation testing score/i.test(li)) {
      const block: string[] = [];
      for (let j = i; j < Math.min(i + 30, lines.length); j++) {
        const line = lines[j];
        if (!line) break;
        if (/^\s*$/.test(line)) break;
        block.push(line.trim());
      }
      return block.join("\n").trim();
    }
  }

  // Prefer assertion-focused lines
  for (let i = 0; i < lines.length; i++) {
    const li = lines[i] ?? "";
    if (
      /expected:<[^>]+>\s+but was:<[^>]+>/i.test(li) ||
      /AssertionError|ComparisonFailure/i.test(li)
    ) {
      const start = Math.max(0, i - 1);
      const end = Math.min(lines.length, i + 6);
      return lines
        .slice(start, end)
        .map((l) => l.trim())
        .filter(Boolean)
        .join("\n");
    }
  }

  // Fallback: concise snippet
  return lines
    .filter(Boolean)
    .slice(0, 8)
    .map((l) => l.trim())
    .join("\n");
}

export function normalizeAssignmentError(errorMsg: string): string {
  let normalized = errorMsg;

  // Canonicalize GitHub runner paths to sp26-cyb1-[REDACTED]/pawtograder
  normalized = normalized
    .replace(
      /(?:file:\/\/)?\/home\/runner\/(?:_work|work)\/sp26-cyb1-[^/]+\/sp26-cyb1-[^/]+\/(pawtograder|pawtograder-grading)([^\s]*)/gi,
      "sp26-cyb1-[REDACTED]/pawtograder$2",
    )
    .replace(
      /(?:file:\/\/)?\/home\/runner\/(?:_work|work)\/sp26-cyb1-[^/]+\/sp26-cyb1-[^/]+/gi,
      "sp26-cyb1-[REDACTED]",
    )
    .replace(/sp26-cyb1-[A-Za-z0-9_-]+/gi, "sp26-cyb1-[REDACTED]");

  // Collapse expected/actual pairs
  normalized = normalized.replace(
    /expected:<[^>]+>\s+but was:<[^>]+>/gi,
    "expected:<EXPECTED> but was:<ACTUAL>",
  );

  // Normalize counts and percentages
  normalized = normalized.replace(
    /Tests passed:\s*\d+\s*\/\s*\d+/gi,
    "Tests passed: X/Y",
  );
  normalized = normalized.replace(/Tests run:\s*\d+/gi, "Tests run: X");
  normalized = normalized.replace(
    /Faults detected:\s*\d+\s*\/\s*\d+/gi,
    "Faults detected: X/Y",
  );
  normalized = normalized.replace(
    /Mutation testing score:\s*\d+(?:\.\d+)?%/gi,
    "Mutation testing score: X%",
  );
  normalized = normalized.replace(/Total mutants:\s*\d+/gi, "Total mutants: X");
  normalized = normalized.replace(
    /Killed mutants:\s*\d+/gi,
    "Killed mutants: X",
  );
  normalized = normalized.replace(
    /Survived mutants:\s*\d+/gi,
    "Survived mutants: X",
  );

  // Paths and line numbers
  normalized = normalized.replace(
    /\/[^\s]+\.(?:java|kt|txt|md|xml)(?::\d+)?/gi,
    "<path>",
  );
  normalized = normalized.replace(/[A-Za-z]:\\\\[^\s)]+/g, "<path>");
  normalized = normalized.replace(/line \d+/gi, "line X");
  normalized = normalized.replace(/:\d+(?::\d+)?/g, ":X");

  // UUIDs and timestamps
  normalized = normalized.replace(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
    "<uuid>",
  );
  normalized = normalized.replace(/\d{4}-\d{2}-\d{2}T[0-9:.+-Z]+/g, "<ts>");

  // Index-like patterns
  normalized = normalized.replace(/UnitTest\.\[\d+\]/g, "UnitTest.[X]");
  normalized = normalized.replace(/Test\s*#\d+/gi, "Test #X");

  // Whitespace
  normalized = normalized.replace(/\s+/g, " ").trim();
  return normalized;
}

export { createFingerprint };

// Remove markdown emphasis, bullets, and code fences; return trimmed plain text
export function stripMarkdownAndBullets(text: string): string {
  const lines = text.split(/\r?\n/);
  const cleaned = lines
    .map((l) => l.replace(/```/g, "")) // code fences
    .map((l) => l.replace(/\*\*([^*]+)\*\*/g, "$1")) // bold
    .map((l) => l.replace(/^\s*[\*•\-]\s+/g, "")) // bullets at start
    .map((l) => l.replace(/^\s*❌\s*/g, "")) // remove cross marker
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  // Join into coherent paragraph
  return cleaned
    .join(" \n")
    .replace(/\s+\n\s+/g, " \n")
    .trim();
}

// Build a clean error text suitable for LLM prompts
export function buildCleanErrorText(
  core: string,
  testName?: string,
  categoryId?: string,
): string {
  const plain = stripMarkdownAndBullets(core);
  const shouldPrefix =
    !!testName &&
    !/^dependency_not_met|mutation_testing_|test_compilation_failed$/.test(
      categoryId || "",
    );
  if (shouldPrefix) {
    return `Test failed: ${testName}\n${plain}`.trim();
  }
  return plain;
}
