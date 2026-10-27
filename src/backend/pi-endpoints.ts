import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import type { CustomProviderConfig } from "./custom-provider-config";
import type { PiMcpExtension } from "./pi-mcp";
import { providerCall } from "./provider-client-effects";

// The user's custom endpoints, as Pi providers of this process only. Each endpoint id is a Pi provider
// id, and each model id is the endpoint's own, so OpenBot's model id `<endpointId>/<modelId>` names
// the Pi provider and model exactly as the `pi` client's ids do.
//
// The endpoints, keys and header values come from the environment, as the key-only providers' keys
// do, and the extension removes the variable before a tool can start a child process. Nothing
// secret is written to the extension file. Pi runs an extension again when it switches sessions, so
// the list stays in a process slot for those later runs.

const ENDPOINTS_VARIABLE = "OPENBOT_PI_ENDPOINTS";

/**
 * Pi lists a model only when its provider has a key, and a local server such as Ollama needs none.
 * Pi sends this placeholder, which such a server ignores.
 */
const NO_KEY = "openbot-no-key";

/** Pi's model fields that an endpoint does not report. The values are Pi's defaults for models.json. */
const MODEL_DEFAULTS = {
  reasoning: false,
  input: ["text"],
  contextWindow: 128_000,
  maxTokens: 16_384,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
} as const;

const SOURCE = `export default function (pi) {
  const slot = Symbol.for("openbot.pi.endpoints");
  globalThis[slot] ??= process.env.${ENDPOINTS_VARIABLE};
  delete process.env.${ENDPOINTS_VARIABLE};
  if (!globalThis[slot]) return;
  for (const endpoint of JSON.parse(globalThis[slot])) pi.registerProvider(endpoint.id, endpoint.config);
}
`;

/**
 * Anthropic's OpenAI-compatible endpoint ignores prompt caching, so an endpoint on Anthropic's own API
 * host uses the Messages API, as the OpenCode configuration did. Pi's Anthropic adapter adds the
 * `/v1/messages` path itself.
 */
function anthropicOrigin(baseUrl: string): string | null {
  const url = URL.parse(baseUrl);
  return url?.protocol === "https:" && url.hostname === "api.anthropic.com" ? url.origin : null;
}

/** A header value reads `$` as an environment reference, and `$$` as a literal `$`. */
function literalHeader(value: string): string {
  // A function replacer: in a replacement string, `$$` is one `$`.
  return value.replaceAll("$", () => "$$");
}

/** A key also reads a leading `!` as a command. */
function literalKey(value: string): string {
  return literalHeader(value).replace(/^!/u, () => "$!");
}

function registration(endpoint: CustomProviderConfig) {
  const anthropic = anthropicOrigin(endpoint.baseUrl);
  const headers: Record<string, string> = {};
  // Pi prefers a key that `/login` stored in its auth.json for a provider of the same id to the key
  // registered here. A header replaces either key, so the saved key is the one sent.
  if (endpoint.apiKey)
    headers[anthropic ? "x-api-key" : "Authorization"] = anthropic ? endpoint.apiKey : `Bearer ${endpoint.apiKey}`;
  for (const header of endpoint.headers) {
    for (const name of Object.keys(headers)) if (name.toLowerCase() === header.name.toLowerCase()) delete headers[name];
    headers[header.name] = header.value;
  }
  return {
    id: endpoint.id,
    config: {
      baseUrl: anthropic ?? endpoint.baseUrl,
      api: anthropic ? "anthropic-messages" : "openai-completions",
      apiKey: literalKey(endpoint.apiKey ?? NO_KEY),
      ...(Object.keys(headers).length > 0
        ? { headers: Object.fromEntries(Object.entries(headers).map(([name, value]) => [name, literalHeader(value)])) }
        : {}),
      models: endpoint.models.map((model) => ({ id: model.id, name: model.name, ...MODEL_DEFAULTS })),
    },
  };
}

/** The endpoints that Pi can list: an endpoint with no models would show as a broken one. */
export function usablePiEndpoints(endpoints: readonly CustomProviderConfig[]): readonly CustomProviderConfig[] {
  return endpoints.filter((endpoint) => endpoint.models.length > 0);
}

/** Owns one temporary, secret-free extension file that registers the saved endpoints in Pi. */
export const createPiEndpointExtension = Effect.fn("PiEndpoints.createExtension")(function* (
  endpoints: readonly CustomProviderConfig[],
  directory?: string,
) {
  const root = directory ?? tmpdir();
  yield* providerCall(() => mkdir(root, { recursive: true, mode: 0o700 }));
  const folder = yield* providerCall(() => mkdtemp(join(root, "openbot-pi-")));
  const path = join(folder, "endpoints.mjs");
  yield* providerCall(() => writeFile(path, SOURCE, { mode: 0o600 })).pipe(
    Effect.onError(() => providerCall(() => rm(folder, { recursive: true, force: true })).pipe(Effect.orDie)),
  );
  const secrets = endpoints.flatMap((endpoint) => [
    ...(endpoint.apiKey ? [endpoint.apiKey] : []),
    ...endpoint.headers.map((header) => header.value),
  ]);
  return {
    path,
    environment: { [ENDPOINTS_VARIABLE]: JSON.stringify(endpoints.map(registration)) },
    secrets: secrets.filter((secret) => secret.length > 0),
    close: () => providerCall(() => rm(folder, { recursive: true, force: true })),
  } satisfies PiMcpExtension;
});
