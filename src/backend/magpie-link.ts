// Magpie can connect OpenBot from its own Agents page, through a Magpie agent plugin. Magpie writes the model it picks, the gateway root and the key that
// names OpenBot to the gateway into one small JSON file that OpenBot owns, and removes them again on
// disconnect. Main watches the file (`../main/magpie-link-watcher.ts`); this module holds its path
// and its parser, which the Magpie provider and the Settings page read.
//
// Magpie and the user can both write the file, so each value is checked here, and a value that
// fails a check counts as absent: OpenBot then uses its own discovery and default for it.

import { join } from "node:path";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";

/** What Magpie set for OpenBot. A null value is one that Magpie did not set. */
export interface MagpieLink {
  /** The Magpie model id that new Magpie agents start on. */
  model: string | null;
  /** The gateway root, such as `http://127.0.0.1:3425`, without a trailing slash. */
  baseUrl: string | null;
  /** The key that names OpenBot to the gateway, such as `magpie-openbot`. */
  apiKey: string | null;
}

export const NO_MAGPIE_LINK: MagpieLink = { model: null, baseUrl: null, apiKey: null };

/** The folder that Magpie looks for to find OpenBot. OpenBot makes it at each start. */
export function magpieLinkDirectory(home: string): string {
  return join(home, ".config", "openbot");
}

/** The file that Magpie writes. The plugin names it as `~/.config/openbot/magpie.json`. */
export function magpieLinkPath(home: string): string {
  return join(magpieLinkDirectory(home), "magpie.json");
}

/** The file is small. A larger one is not Magpie's and is not read. */
export const MAGPIE_LINK_MAX_BYTES = 64 * 1024;

const MAX_MODEL_LENGTH = 200;
const MAX_URL_LENGTH = 512;
const MAX_KEY_LENGTH = 256;

/** Printable ASCII with no space: a model id or a key that a header or a variable can carry. */
const TOKEN = /^[\x21-\x7e]+$/u;

/** Hosts of this computer. The gateway key and the prompts go to no other address from this file. */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

function token(value: unknown, maxLength: number): string | null {
  if (!isString(value)) return null;
  const text = value.trim();
  return text.length > 0 && text.length <= maxLength && TOKEN.test(text) ? text : null;
}

/** An `http` or `https` root on this computer, without credentials, query or fragment. */
export function magpieLinkBaseUrl(value: unknown): string | null {
  if (!isString(value)) return null;
  const text = value.trim();
  if (!text || text.length > MAX_URL_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) return null;
  if (url.username || url.password || url.search || url.hash) return null;
  // The root, also when the OpenAI-compatible `/v1` address was written: OpenBot adds the paths.
  const path = url.pathname.replace(/\/+$/u, "").replace(/\/v1$/u, "");
  return `${url.protocol}//${url.host}${path}`;
}

/** The values in the text of the file. Text that is not a JSON object gives no values. */
export function parseMagpieLink(text: string): MagpieLink {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return NO_MAGPIE_LINK;
  }
  if (!isDynamicRecord(parsed)) return NO_MAGPIE_LINK;
  return {
    model: token(parsed.model, MAX_MODEL_LENGTH),
    baseUrl: magpieLinkBaseUrl(parsed.baseUrl),
    apiKey: token(parsed.apiKey, MAX_KEY_LENGTH),
  };
}

export function sameMagpieLink(left: MagpieLink, right: MagpieLink): boolean {
  return left.model === right.model && left.baseUrl === right.baseUrl && left.apiKey === right.apiKey;
}
