/**
 * Helpers for text that ends up inside Discord embed markdown.
 *
 * Mesh messages are plain text, but Discord renders embed descriptions and
 * field values as markdown. A message of `[meshview](https://evil.example)`
 * therefore shows up as a clickable "meshview" link whose destination is
 * hidden. Bare URLs (`https://example.com`) are auto-linked by Discord and
 * show their real destination, so they are left alone.
 */

/**
 * Prefix every `[` that opens a masked link (`[label](url)`) with a
 * backslash so Discord shows the literal text instead of a link. Each link
 * is handled on its own; discord.js's escapeMaskedLink uses a greedy match
 * and only escapes the first of several links on a line.
 */
export const escapeMaskedLinks = (text: string): string => {
  if (typeof text !== "string" || text.length === 0) {
    return text;
  }
  return text.replace(/\[(?=[^\]\n]*\]\()/g, "\\[");
};

/**
 * Make a string safe to use as the label of a masked link we build
 * ourselves (`[label](url)`). A `]` in the label would end the link early
 * and let the rest of the label supply its own destination, so square
 * brackets are swapped for parentheses, which have no meaning inside a label.
 */
export const sanitizeLinkLabel = (label: string): string => {
  if (typeof label !== "string") {
    return "";
  }
  return label.replace(/\[/g, "(").replace(/\]/g, ")");
};
