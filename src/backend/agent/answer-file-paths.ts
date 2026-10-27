import { isSupportedAttachmentName } from "@openbot/contracts/attachment-files";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";

/**
 * A path starts at the start of a line, after a space, or after an opening quote or bracket, so the path
 * part of a web address does not match. `file://` links are read separately.
 */
const ABSOLUTE_PATH = /(?<=^|[\s"'`(<[])(?:~\/|\/|[A-Za-z]:[\\/])[^\s"'`<>()[\]]+/gu;
const FILE_URL = /file:\/\/(\/[^\s"'`<>()[\]]+)/gu;
const TRAILING_PUNCTUATION = /[.,;:!?]+$/u;

/**
 * The absolute paths of files that an agent answer names and that can be attachments. The answer text
 * does not change; the turn end attaches the files that resolve inside the agent's permitted folders.
 * SVG cannot be an attachment, so it stays a path.
 */
export function answerFilePaths(text: string): string[] {
  const paths = new Set<string>();
  const add = (value: string) => {
    const path = value.replace(TRAILING_PUNCTUATION, "");
    if (path.toLowerCase().endsWith(".svg") || !isSupportedAttachmentName(path)) return;
    if (paths.size < INPUT_LIMITS.attachments) paths.add(path);
  };
  for (const match of text.matchAll(FILE_URL)) {
    const path = match[1] ?? "";
    try {
      add(decodeURIComponent(path));
    } catch {
      add(path);
    }
  }
  for (const match of text.matchAll(ABSOLUTE_PATH)) add(match[0]);
  return [...paths];
}
