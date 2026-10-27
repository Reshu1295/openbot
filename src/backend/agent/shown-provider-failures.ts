import { sourceText } from "@openbot/i18n/source";

/**
 * The provider failure texts that a generation and a channel show as they stand. Each is a catalog
 * text with no placeholder, so it holds nothing from the provider and names no profile. The match is
 * exact, so a key with a placeholder cannot be listed: its text never equals its template.
 */
const SHOWN_PROVIDER_FAILURES: ReadonlySet<string> = new Set([sourceText("error.provider.opencodeFreeLimit")]);

/** The message itself when it is a shown provider failure, else null. */
export function shownProviderFailure(message: string): string | null {
  return SHOWN_PROVIDER_FAILURES.has(message) ? message : null;
}
