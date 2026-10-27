import { bytesToBase64 } from "@openbot/team-client/base64";
import type { MessageImageFile } from "@openbot/ui/features/conversation/MarkdownMessageText";
import { releaseFilePreviewPage } from "./conversation-port";
import type { ConversationRuntime } from "./conversation-runtime";

/**
 * A larger named image keeps only its chip. The file preview has no size-only read, so a large
 * file is read once, as a chip click reads it, and is then dropped.
 */
const INLINE_IMAGE_BYTES = 8 * 1024 * 1024;
/** The cached `data:` URLs together take at most this many characters. */
const CACHE_CHARACTERS = 64 * 1024 * 1024;

/**
 * The types that show inline. Each shows as a `data:` URL in an `<img>`, which runs no script and
 * has an opaque origin, so an SVG gets nothing of the app even when it is opened on its own.
 */
const INLINE_IMAGE_TYPES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/svg+xml",
]);

/**
 * Reads the image files that agent messages name, through the same file preview as their chips.
 * `scope` names the host, the message, and for a workspace path the agent whose workspace holds it.
 * Each message keeps its own entry: an agent can write the same path again, and a newer message
 * must show the newer file.
 */
export function createMessageImageFiles(
  agent: Pick<ConversationRuntime["agent"], "previewSharedFile" | "previewWorkspaceFile">,
) {
  // Insertion order is the use order: the first entry is the least recently used.
  const cache = new Map<string, { job: Promise<string | null>; characters: number }>();
  let total = 0;
  const drop = (key: string) => {
    const entry = cache.get(key);
    if (!entry) return;
    cache.delete(key);
    total -= entry.characters;
  };

  async function read(file: MessageImageFile, agentId: string | undefined): Promise<string | null> {
    if (file.kind === "workspace" && !agentId) return null;
    const preview =
      file.kind === "shared"
        ? await agent.previewSharedFile({ path: file.path })
        : await agent.previewWorkspaceFile({ agentId: agentId ?? "", path: file.path });
    releaseFilePreviewPage(preview.pageUrl);
    const type = preview.mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
    if (preview.previewKind !== "image" || !preview.bytes || !INLINE_IMAGE_TYPES.has(type)) return null;
    if (preview.bytes.byteLength > INLINE_IMAGE_BYTES) return null;
    return `data:${type};base64,${bytesToBase64(preview.bytes)}`;
  }

  return (
    file: MessageImageFile,
    scope: { serverId: string; messageId: string; agentId: string | undefined },
  ): Promise<string | null> => {
    const agentId = file.kind === "workspace" ? scope.agentId : "";
    const key = `${scope.serverId}:${scope.messageId}:${file.kind}:${agentId}:${file.path}`;
    const cached = cache.get(key);
    if (cached) {
      cache.delete(key);
      cache.set(key, cached);
      return cached.job;
    }
    const entry = { job: read(file, scope.agentId), characters: 0 };
    cache.set(key, entry);
    entry.job.then(
      (url) => {
        if (cache.get(key) !== entry) return;
        entry.characters = url?.length ?? 0;
        total += entry.characters;
        for (const oldKey of cache.keys()) {
          if (total <= CACHE_CHARACTERS || oldKey === key) break;
          drop(oldKey);
        }
      },
      // A failed read is not kept: the file can appear later, and the next show tries again.
      () => {
        if (cache.get(key) === entry) drop(key);
      },
    );
    return entry.job.catch(() => null);
  };
}
