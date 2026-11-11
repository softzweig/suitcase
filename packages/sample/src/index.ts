/** Human readable identifier of this package. */
export const PACKAGE_NAME = "@softzweig/suitcase-sample";

export type GreetingOptions = {
  /** Who the greeting is addressed to. */
  readonly recipient: string;
  /** Punctuation appended to the greeting. Defaults to `!`. */
  readonly punctuation?: string;
};

/**
 * Builds a greeting for the given recipient.
 *
 * @throws {TypeError} When the recipient is blank.
 */
export function greet({ recipient, punctuation = "!" }: GreetingOptions): string {
  const name = recipient.trim();

  if (name.length === 0) {
    throw new TypeError("recipient must not be blank");
  }

  return `Hello, ${name}${punctuation}`;
}
