// Pure output parsing for the Chat Coach. The prompt makes the model think
// privately inside <thinking>…</thinking> and then write only the user-facing
// answer inside <response>…</response>. This pulls out the response and never
// lets the thinking reach the UI. No I/O, so it's fully unit-testable.

/** Return only the <response> body. If the model didn't use the tags (a
    fallback model, or output truncated before the closing tag), degrade
    gracefully to whatever real answer is present. */
export function extractResponse(raw: string): string {
  const closed = raw.match(/<response>([\s\S]*?)<\/response>/i);
  if (closed) return closed[1].trim();
  const open = raw.match(/<response>([\s\S]*)/i); // opened but truncated before close
  if (open) return open[1].trim();
  // No response tag at all — drop any thinking block and return the rest.
  const stripped = raw
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .replace(/<\/?(thinking|response)>/gi, '')
    .trim();
  return stripped || raw.trim();
}
