// The OpenCode config OpenBot hands to a spawned `opencode acp` process.
//
// OpenCode reads its own global and project config files first and then applies
// `OPENCODE_CONFIG_CONTENT` as one more layer, so this is an overlay: it adds a provider without
// touching the user's file or their `opencode auth login` credentials. Verified against OpenCode
// 1.18.27, where `opencode models` listed the user's own 20 models plus the two named here.
//
// This lives beside `provider-drivers.ts` rather than inside it because the driver table is a table:
// the shape of one CLI's config is a concern of its own, and it is the half worth unit testing.

/**
 * The stored OpenCode Go key, under a built-in provider that `OPENCODE_API_KEY` also reaches.
 *
 * OpenCode applies the key from its own `auth.json` (`opencode auth login`) after the environment
 * key, so an old key saved there replaced the key pasted into OpenBot, and a new key could not fix
 * an expired one (#2544). Config `options.apiKey` comes after both. Checked in OpenCode 1.18.30 to
 * 1.18.35: with both keys present, the request carried the config key.
 */
interface OpenCodeKeyEntry {
  readonly options: { readonly apiKey: string };
}

/** One rule per tool pattern, which is all OpenBot sends under `permission`. */
type OpenCodePermissionLayer = Readonly<Record<string, "allow" | "ask" | "deny">>;

/** The config layer OpenBot owns on `OPENCODE_CONFIG_CONTENT`. The user's own file is untouched. */
interface OpenCodeConfig {
  readonly permission?: OpenCodePermissionLayer;
  readonly provider?: Readonly<Record<string, OpenCodeKeyEntry>>;
}

/** What a caller starts from: every layer except the providers this module adds. */
export type OpenCodeConfigBase = Omit<OpenCodeConfig, "provider">;

/**
 * Profile generation runs a throwaway OpenCode session for a one-shot prompt, so it must not be able
 * to touch the computer. This layer is the reason the key layer has to merge rather than replace:
 * both live under the same environment variable.
 *
 * `bash` and `read` ask rather than deny. OpenCode leaves a denied tool out of the request, and Zen
 * refuses a free model a request that offers no `bash` and `read`: "OpenCode's free tier can only be
 * used from within OpenCode". Checked in OpenCode 1.19.3 and 2.1.1. The profile client cancels every
 * permission request, and OpenCode rejects a cancelled one, so neither tool can run.
 */
export const OPENCODE_PROFILE_CONFIG: OpenCodeConfigBase = { permission: { "*": "deny", bash: "ask", read: "ask" } };

const OPENCODE_CONFIG_ENV = "OPENCODE_CONFIG_CONTENT";

/** The built-in providers that read `OPENCODE_API_KEY`: OpenCode Go and the free tier. */
const OPENCODE_KEY_PROVIDERS = ["opencode-go", "opencode"] as const;

/**
 * What to tell the user when OpenCode will not start a session. A plain OpenCode user needs a Go key,
 * now that the free models run without an account at all.
 */
export const OPENCODE_SIGN_IN_MESSAGE = "OpenCode listed no model. Add an OpenCode Go key to continue.";

/**
 * Merges the stored key into a base layer. Custom endpoints are not here: the `endpoint` provider
 * runs them in the Pi CLI, so OpenCode needs none of them.
 */
function mergeOpenCodeConfig(base: OpenCodeConfigBase, apiKey: string | null): OpenCodeConfig | null {
  if (!apiKey) return Object.keys(base).length > 0 ? { ...base } : null;
  return { ...base, provider: Object.fromEntries(OPENCODE_KEY_PROVIDERS.map((id) => [id, { options: { apiKey } }])) };
}

/**
 * The spawn environment for one OpenCode client. Returns `{}` when there is nothing to configure, so
 * a build with no stored key and no base layer spawns exactly as it did before this existed. With no
 * stored key, the user's own `opencode auth login` keys stay in use.
 */
export function openCodeConfigEnv(base: OpenCodeConfigBase, apiKey: string | null): Record<string, string> {
  const config = mergeOpenCodeConfig(base, apiKey);
  return config ? { [OPENCODE_CONFIG_ENV]: JSON.stringify(config) } : {};
}

/** OpenCode's own providers, by the names that OpenCode 1 showed (models.dev). */
const OPENCODE_PROVIDER_NAMES: Readonly<Record<string, string>> = {
  opencode: "OpenCode",
  "opencode-go": "OpenCode Go",
};

/**
 * A model name with the provider's name before the `/`, as OpenCode 1 sent it.
 *
 * OpenCode 1.19.3 named a model `OpenCode/Big Pickle`; OpenCode 2.1.1 sends the provider id,
 * `opencode/Big Pickle`. The model picker groups by that part, so it showed the id.
 */
export function openCodeModelName(id: string, name: string): string {
  const separator = id.indexOf("/");
  if (separator <= 0) return name;
  const providerId = id.slice(0, separator);
  if (!name.startsWith(`${providerId}/`)) return name;
  const providerName = OPENCODE_PROVIDER_NAMES[providerId];
  return providerName ? `${providerName}${name.slice(providerId.length)}` : name;
}
