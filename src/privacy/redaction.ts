/**
 * Redacts long snippets for safe logging by truncating to 120 characters
 * and appending an ellipsis. Returns undefined for falsy input.
 */
export function redactSnippet(snippet?: string): string | undefined {
  if (!snippet) return undefined
  return snippet.length > 120 ? snippet.slice(0, 120) + '…' : snippet
}


