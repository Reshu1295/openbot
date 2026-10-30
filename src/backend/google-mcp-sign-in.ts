/**
 * The OpenBot Google sign-in app, for Google's own MCP servers.
 *
 * Google's MCP servers do not let a client register itself, so each user had to make a sign-in app in
 * a Google Cloud project and type its client ID and secret. OpenBot has one sign-in app instead. Its
 * client ID is public; its secret is only in Signal. A server listed here gets that app when the user
 * has not saved one, and its two token requests go through Signal, which adds the secret. Everything
 * else is the usual MCP sign-in: the code comes back to this computer, the tokens stay here, and the
 * MCP traffic goes to Google directly.
 */

import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { GoogleOAuthTokenRequest } from "@openbot/contracts/signal-protocol/google-oauth";

const GOOGLE_SCOPE = "https://www.googleapis.com/auth/";

function scopes(...names: string[]): string {
  return names.map((name) => `${GOOGLE_SCOPE}${name}`).join(" ");
}

/**
 * The scopes that each server asks for, keyed by its exact URL. Google's configuration guide
 * (https://developers.google.com/workspace/guides/configure-mcp-servers) names read scopes, and the
 * tool reference names what each write tool needs. Agents write too, so each server also gets the
 * scope of its write tools: `gmail.modify` for labels, trash and spam, `drive` for files that OpenBot
 * did not create, and `calendar.events` to create, change, delete and answer events. Docs and Sheets
 * write with `documents` and `spreadsheets`, and Slides with `presentations`.
 */
export const GOOGLE_MCP_SCOPES: Readonly<Record<string, string>> = {
  "https://gmailmcp.googleapis.com/mcp/v1": scopes("gmail.readonly", "gmail.compose", "gmail.modify"),
  "https://drivemcp.googleapis.com/mcp/v1": scopes("drive.readonly", "drive.file", "drive"),
  "https://docsmcp.googleapis.com/mcp/v1": scopes("drive.readonly", "drive.file", "documents.readonly", "documents"),
  "https://sheetsmcp.googleapis.com/mcp/v1": scopes(
    "drive.readonly",
    "drive.file",
    "spreadsheets.readonly",
    "spreadsheets",
  ),
  "https://slidesmcp.googleapis.com/mcp/v1": scopes(
    "drive.readonly",
    "drive.file",
    "presentations.readonly",
    "presentations",
  ),
  "https://calendarmcp.googleapis.com/mcp/v1": scopes(
    "calendar.calendarlist.readonly",
    "calendar.events.freebusy",
    "calendar.events.readonly",
    "calendar.events",
  ),
};

/** Google's token endpoint, as its authorization server metadata names it. */
export const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

/**
 * Sends one token request through Signal and answers with Google's answer as Signal returns it. It
 * fails with a sentence for the user when this computer cannot ask Signal, for example with no
 * OpenBot account.
 */
export type GoogleTokenBroker = (
  request: GoogleOAuthTokenRequest,
  signal: AbortSignal | undefined,
) => Promise<Response>;

export interface GoogleSignIn {
  /** The client ID of the OpenBot Google sign-in app. */
  clientId: string;
  broker: GoogleTokenBroker;
}

/**
 * A fetch that sends the token requests of the OpenBot Google sign-in app to `broker`, and every
 * other request to `fetch`. The SDK posts a form with the client ID and no secret: the app is public
 * to this computer. A request for another client, such as a sign-in app the user saved, goes to Google
 * as it is.
 */
export function withGoogleTokenBroker(fetch: FetchLike, google: GoogleSignIn): FetchLike {
  return async (input, init) => {
    const url = input instanceof URL ? input.href : String(input);
    if (init?.method !== "POST" || url !== GOOGLE_TOKEN_ENDPOINT || !(init.body instanceof URLSearchParams))
      return fetch(input, init);
    const form = init.body;
    if (form.get("client_id") !== google.clientId) return fetch(input, init);
    const request = tokenRequest(form, google.clientId);
    // An unknown grant is not one of the two the broker passes on. Google would refuse it without the secret too.
    if (!request) return fetch(input, init);
    return google.broker(request, init.signal ?? undefined);
  };
}

function tokenRequest(form: URLSearchParams, clientId: string): GoogleOAuthTokenRequest | null {
  const resource = form.get("resource");
  const optional = resource ? { resource } : {};
  const grant = form.get("grant_type");
  if (grant === "authorization_code") {
    const code = form.get("code");
    const codeVerifier = form.get("code_verifier");
    const redirectUri = form.get("redirect_uri");
    if (!code || !codeVerifier || !redirectUri) return null;
    return { grant, clientId, code, codeVerifier, redirectUri, ...optional };
  }
  if (grant === "refresh_token") {
    const refreshToken = form.get("refresh_token");
    if (!refreshToken) return null;
    return { grant, clientId, refreshToken, ...optional };
  }
  return null;
}
