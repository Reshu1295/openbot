import { bytesToBase64 } from "@openbot/team-client/base64";
import type { MessageImageFile } from "@openbot/ui/features/conversation/MarkdownMessageText";
import { releaseFilePreviewPage } from "./conversation-port";
import type { ConversationRuntime } from "./conversation-runtime";

/** A larger named image keeps only its chip: a preview must not cost a large read. */
const INLINE_IMAGE_BYTES = 8 * 1024 * 1024;
const CACHE_ENTRIES = 64;

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
 * `scope` names the host and, for a workspace path, the agent whose workspace holds it.
 */
export function createMessageImageFiles(
  agent: Pick<ConversationRuntime["agent"], "previewSharedFile" | "previewWorkspaceFile">,
) {
  // Insertion order is the use order: the first entry is the least recently used.
  const cache = new Map<string, Promise<string | null>>();

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

  return (file: MessageImageFile, scope: { serverId: string; agentId: string | undefined }) => {
    const key = `${scope.serverId}:${file.kind}:${file.kind === "workspace" ? scope.agentId : ""}:${file.path}`;
    const cached = cache.get(key);
    if (cached) {
      cache.delete(key);
      cache.set(key, cached);
      return cached;
    }
    // A failed read is not kept: the file can appear later, and the next show tries again.
    const job = read(file, scope.agentId).catch(() => {
      if (cache.get(key) === job) cache.delete(key);
      return null;
    });
    cache.set(key, job);
    for (const oldKey of cache.keys()) {
      if (cache.size <= CACHE_ENTRIES) break;
      cache.delete(oldKey);
    }
    return job;
  };
}
