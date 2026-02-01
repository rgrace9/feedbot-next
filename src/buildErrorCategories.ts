export interface ErrorCategory {
  id: string;
  name: string;
  patterns: RegExp[];
  description: string;
  studentFriendlyMessage?: string;
}

export const BUILD_ERROR_CATEGORIES: ErrorCategory[] = [
  // Java/Toolchain version mismatch
  {
    id: "java_version_mismatch",
    name: "Java Version Incompatibility",
    patterns: [
      /unsupported class file major version \d+/i,
      /unsupported class major version \d+/i,
      /unsupported class (?:file )?major version (?:\d+|x)/i,
      /has been compiled by a more recent version of the Java Runtime/i,
      /UnsupportedClassVersionError/i,
      /major\.minor version/i,
      /source (?:level|option) \d+ is no longer supported/i,
      /target (?:release|option) \d+ (?:is )?not supported/i,
      /invalid target release: \d+/i,
    ],
    description: "Code compiled with newer Java version than runtime supports",
    studentFriendlyMessage:
      "Your code was compiled with a different Java version. Check your Java SDK settings.",
  },
  // Java toolchain missing or incompatible
  {
    id: "java_toolchain_missing",
    name: "Java Toolchain Not Found",
    patterns: [
      /Cannot find a Java installation matching this task'?s? requirements/i,
      /No matching toolchain/i,
      /Could not target platform: 'Java SE \d+' using tool chain/i,
      /Failed to calculate the value of task ':[^']+' property 'javaCompiler'/i,
      /property 'javaCompiler'/i,
    ],
    description:
      "Gradle could not resolve a Java toolchain matching the requested language version/vendor",
    studentFriendlyMessage:
      "The build needs a different Java version than what's available. Ensure the required JDK is installed and configured.",
  },
  // NullAway specific subcategories (beginner-friendly)
  {
    id: "nullaway_param_nullable",
    name: "NullAway: Nullable Parameter",
    patterns: [
      /error: \[NullAway\] passing @Nullable .* where @NonNull is required/i,
    ],
    description:
      "Passing a @Nullable value where a @NonNull parameter is required",
    studentFriendlyMessage:
      "A method received a null where it requires a non-null. Fix: add a null check or provide a non-null value.",
  },
  {
    id: "nullaway_field_assignment",
    name: "NullAway: Nullable Field Assignment",
    patterns: [
      /error: \[NullAway\] assigning @Nullable expression to @NonNull field/i,
    ],
    description:
      "Assigning a @Nullable expression to a field annotated @NonNull",
    studentFriendlyMessage:
      "Assigning a possibly-null value to a non-null field. Fix: ensure the value is non-null or change the field to @Nullable.",
  },
  {
    id: "nullaway_return_nullable",
    name: "NullAway: Nullable Return",
    patterns: [
      /error: \[NullAway\] returning @Nullable expression from method with @NonNull return type/i,
    ],
    description:
      "Returning a @Nullable expression from a method with @NonNull return type",
    studentFriendlyMessage:
      "Returning a possibly-null value from a method that must return non-null. Fix: return a non-null value or update the method’s annotation.",
  },
  {
    id: "nullaway_deref_nullable",
    name: "NullAway: Nullable Dereference",
    patterns: [/error: \[NullAway\] dereferenced expression .* is @Nullable/i],
    description: "Dereferencing an expression that may be null",
    studentFriendlyMessage:
      "Dereferencing a value that might be null. Fix: check for null before using it.",
  },
  // NullAway catch-all
  {
    id: "nullability_error",
    name: "Nullability Error",
    patterns: [/\[NullAway\]/i],
    description: "Code violates @NonNull/@Nullable contracts (NullAway)",
    studentFriendlyMessage:
      "A value that can be null is used where a non-null is required. Double-check null checks and annotations.",
  },
  // Failing tests summary
  {
    id: "failing_tests",
    name: "Failing Tests",
    patterns: [
      /There were failing tests/i,
      /There were \d+ failing tests/i,
      /Failed tests:/i,
    ],
    description: "The test suite reported failing tests",
    studentFriendlyMessage:
      "Some tests failed. Open the test report shown in the logs and fix the failing test cases.",
  },
  // Symbol missing
  {
    id: "symbol_not_found",
    name: "Symbol Not Found",
    patterns: [/cannot find symbol/i, /symbol not found/i],
    description: "Variable, method, or class does not exist or is not imported",
    studentFriendlyMessage:
      "A variable, method, or class name could not be found. Check for typos or missing imports.",
  },
  // Package import problems
  {
    id: "type_mismatch",
    name: "Type Mismatch",
    patterns: [
      /incompatible types/i,
      /required: .+ found: .+/i,
      /cannot be converted to/i,
    ],
    description: "Wrong type assigned to variable or returned from method",
    studentFriendlyMessage:
      "You are trying to use the wrong type. Check that your variable types match what you're assigning to them.",
  },
  {
    id: "operator_type_mismatch",
    name: "Operator Type Mismatch",
    patterns: [/bad operand types for binary operator/i],
    description: "Using operators on incompatible types",
    studentFriendlyMessage:
      "An operator is used on types that are incompatible. Check your operand types.",
  },
  {
    id: "syntax_error",
    name: "Syntax Error",
    patterns: [
      /';' expected/i,
      /illegal start of expression/i,
      /not a statement/i,
      /<identifier> expected/i,
    ],
    description: "Code has syntax errors (missing semicolons, brackets, etc.)",
    studentFriendlyMessage:
      "There is a syntax error in your code. Check for missing semicolons, brackets, or parentheses.",
  },
  {
    id: "method_signature",
    name: "Method Signature Error",
    patterns: [
      /method .+ cannot be applied to/i,
      /no suitable method found for/i,
      /constructor .+ cannot be applied to given types/i,
    ],
    description: "Method called with wrong number or type of arguments",
    studentFriendlyMessage:
      "You are calling a method with the wrong arguments. Check the method signature.",
  },
  {
    id: "override_mismatch",
    name: "Override/Implements Mismatch",
    patterns: [
      /does not override or implement a method from a supertype/i,
      /MissingOverride/i,
    ],
    description: "Method override annotations or signatures are incorrect",
    studentFriendlyMessage:
      "A method isn't correctly overriding or implementing a parent interface/class. Check annotations and signatures.",
  },
  {
    id: "class_declaration",
    name: "Class Declaration Error",
    patterns: [/class .+ is public, should be declared in a file named/i],
    description: "Public class name does not match filename",
    studentFriendlyMessage: "Your public class name must match the filename.",
  },
  {
    id: "duplicate_class",
    name: "Duplicate Class",
    patterns: [/duplicate class:/i, /is already defined/i],
    description: "Duplicate class or redefinition detected",
    studentFriendlyMessage:
      "A class appears more than once or is redefined. Remove duplicates and ensure one definition per class.",
  },
  {
    id: "abstract_instantiation",
    name: "Abstract Class Instantiation",
    patterns: [/is abstract; cannot be instantiated/i],
    description: "Attempting to instantiate an abstract class",
    studentFriendlyMessage:
      "You cannot create an instance of an abstract class. Use a concrete subclass.",
  },
  {
    id: "missing_abstract_override",
    name: "Missing Abstract Method Override",
    patterns: [/is not abstract and does not override abstract method/i],
    description:
      "Concrete class missing required abstract method implementation",
    studentFriendlyMessage:
      "Implement all abstract methods from the parent class or mark your class abstract.",
  },
  {
    id: "unclosed_block",
    name: "Unclosed Block",
    patterns: [/reached end of file while parsing/i],
    description: "Missing closing brace or bracket",
    studentFriendlyMessage:
      "You are missing a closing brace }. Check that all your blocks are properly closed.",
  },
  {
    id: "package_error",
    name: "Package Error",
    patterns: [/package .+ does not exist/i],
    description: "Package import does not exist or is misspelled",
    studentFriendlyMessage:
      "A package you are trying to import does not exist. Check your import statements.",
  },
  // Static analysis and formatting
  {
    id: "checkstyle_violation",
    name: "Checkstyle Violation",
    patterns: [
      /Checkstyle rule violations were found/i,
      /Checkstyle violations were found/i,
    ],
    description: "Checkstyle reported coding style violations",
    studentFriendlyMessage:
      "Code style rules were violated. Open the Checkstyle report referenced in the logs and fix those issues.",
  },
  {
    id: "spotless_violation",
    name: "Spotless/Formatting Violation",
    patterns: [
      /spotlessJavaCheck/i,
      /spotlessJavaApply/i,
      /format violations/i,
      /There were \d+ lint error\(s\)/i,
    ],
    description: "Spotless formatter or lint rules failed",
    studentFriendlyMessage:
      "The formatter/linter found issues. Run the formatter locally or address the listed violations.",
  },
  {
    id: "errorprone_warning",
    name: "Error Prone Warning",
    patterns: [
      /DuplicateBranches/i,
      /EmptyBlockTag/i,
      /EqualsGetClass/i,
      /UnnecessaryParentheses/i,
      /FormatString/i,
    ],
    description: "Static analysis detected code-quality issues",
    studentFriendlyMessage:
      "Static analysis found potential issues. Review warnings and refactor accordingly.",
  },
];

// Helper function to categorize an error
export function categorizeError(errorMessage: string): ErrorCategory | null {
  for (const category of BUILD_ERROR_CATEGORIES) {
    for (const pattern of category.patterns) {
      if (pattern.test(errorMessage)) {
        return category;
      }
    }
  }
  return null; // Unknown error type
}
