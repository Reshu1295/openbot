// The OpenBot Google sign-in app, and how this host sends its token requests to Signal.
//
// The client ID is public: a sign-in sends it to Google in the browser. The client secret is only in
// Signal (`GOOGLE_OAUTH_CLIENTS` in `remote/api`), so the code exchange and the refresh go there with
// this host's remote ticket. See `src/backend/google-mcp-sign-in.ts`.

import { GOOGLE_OAUTH_TOKEN_PATH } from "@openbot/contracts/signal-protocol/google-oauth";
import { sourceText } from "@openbot/i18n/source";
import type { GoogleSignIn, GoogleTokenBroker } from "../backend/google-mcp-sign-in";

/**
 * The "OpenBot Desktop" client (Desktop app, marked for an AI-powered agent) of the Google Cloud
 * project `openbot-a3328`. Its secret is in Signal's `GOOGLE_OAUTH_CLIENTS`.
 */
const GOOGLE_CLIENT_ID = "1006722609038-u9dutshmpumvkl7tgipiv7gkvd2lnf7n.apps.googleusercontent.com";

const GOOGLE_CLIENT_ID_PATTERN = /^[0-9]{1,30}-[a-z0-9]{1,64}\.apps\.googleusercontent\.com$/u;

/** The ticket of this host for Signal, and the Signal address. `null` when this host has none. */
export type HostTicket = () => Promise<{ ticket: string; signalUrl: string } | null>;

/** The OpenBot Google sign-in, or null. `OPENBOT_GOOGLE_CLIENT_ID` overrides the client ID. */
export function googleSignIn(hostTicket: HostTicket, env: NodeJS.ProcessEnv = process.env): GoogleSignIn | null {
  const clientId = env.OPENBOT_GOOGLE_CLIENT_ID?.trim() || GOOGLE_CLIENT_ID;
  if (!GOOGLE_CLIENT_ID_PATTERN.test(clientId)) return null;
  return { clientId, broker: googleTokenBroker(hostTicket) };
}

export function googleTokenBroker(hostTicket: HostTicket): GoogleTokenBroker {
  return async (request, signal) => {
    const host = await hostTicket().catch(() => null);
    if (!host) throw new Error(sourceText("error.backend.googleSignInNeedsAccount"));
    return fetch(googleTokenUrl(host.signalUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${host.ticket}`,
      },
      body: JSON.stringify(request),
      redirect: "error",
      ...(signal ? { signal } : {}),
    });
  };
}

/** Signal's Google path on the origin of its socket: `wss:` becomes `https:`, and `ws:` (local) `http:`. */
function googleTokenUrl(signalUrl: string): string {
  const url = new URL(signalUrl);
  url.protocol = url.protocol === "ws:" ? "http:" : "https:";
  url.pathname = GOOGLE_OAUTH_TOKEN_PATH;
  url.search = "";
  url.hash = "";
  return url.toString();
}
