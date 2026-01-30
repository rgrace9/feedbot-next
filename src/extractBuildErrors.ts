// Extract the core error from verbose Gradle output
export function extractCoreError(output: string): string {
  const lines = output.split("\n");

  // 1) Prefer Gradle build error block
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("* What went wrong:")) {
      const errorLines: string[] = [];
      errorLines.push(lines[i]);
      for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
        const line = lines[j];
        if (!line) break;
        if (line.includes("* Try:")) break; // end of error section
        if (line.trim()) errorLines.push(line);
      }
      return errorLines.join("\n").trim();
    }
  }

  // 2) Detect failing tests summary
  for (let i = 0; i < lines.length; i++) {
    if (
      /There were failing tests/i.test(lines[i]) ||
      /Failed tests:/i.test(lines[i])
    ) {
      const errorLines: string[] = [];
      errorLines.push(lines[i].trim());
      for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
        const line = lines[j];
        if (!line) break;
        // stop at next blank preamble or build tips
        if (/^\s*$/.test(line) || /See the report at:/i.test(line)) break;
        errorLines.push(line.trim());
      }
      return errorLines.join("\n").trim();
    }
  }

  // 3) Clean preamble noise and return a concise snippet
  const cleaned = lines
    .filter(
      (l) =>
        !/Beginning grading|Copying student files|Setting up virtual environment|Linting student submission|Running \./.test(
          l,
        ),
    )
    .join("\n");

  return cleaned.substring(0, 300).trim();
}

// Normalize error message for grouping
export function normalizeError(errorMsg: string): string {
  let normalized = errorMsg;

  // Remove specific version numbers
  normalized = normalized.replace(/major version \d+/gi, "major version X");
  normalized = normalized.replace(/gradle-[\d.]+/gi, "gradle-X");

  // Remove file paths
  normalized = normalized.replace(/\/[^\s]+\.jar/g, "<path>");
  normalized = normalized.replace(/file:\/\/[^\s)]+/g, "<path>");
  normalized = normalized.replace(/\/[A-Za-z0-9_\-\/\.]+/g, "<path>");

  // Remove line/column numbers
  normalized = normalized.replace(/line \d+/gi, "line X");
  normalized = normalized.replace(/:\d+:/g, ":X:");
  normalized = normalized.replace(/:\d+/g, ":X");

  // Remove specific class/variable names (keep exception types)
  normalized = normalized.replace(
    /variable ['"]?[A-Za-z_][A-Za-z0-9_]*['"]?/gi,
    "variable X",
  );
  // Only replace likely Java class identifiers (avoid phrases like "class file")
  normalized = normalized.replace(
    /\bclass\s+['"]?[A-Z][A-Za-z0-9_]*['"]?/g,
    "class X",
  );

  // Normalize whitespace
  normalized = normalized.replace(/\s+/g, " ").trim();

  return normalized;
}

// Create fingerprint for grouping
export function createFingerprint(
  normalized: string,
  categoryId: string,
): string {
  const combined = `${categoryId}:${normalized}`;
  let hash = 0;
  for (let i = 0; i < combined.length; i++) {
    hash = (hash << 5) - hash + combined.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

// Main function to extract and group build errors
