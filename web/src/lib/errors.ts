/** A message fit to show the user, whatever was thrown. */
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
