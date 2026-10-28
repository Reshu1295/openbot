import { Effect, Schema } from "effect";
import {
  type AccountAnalytics,
  EMAIL_DELIVERY_PROFILE_ID,
  type EmailKind,
  type EmailResult,
} from "./account-analytics";
import {
  RATE_LIMITED_DELIVERY_ERROR,
  type SmtpEmailConfig,
  sendPrivateContactMessage,
  sendPrivateEmailCode,
  sendPrivateTeamInvite,
  sendPrivateWelcomeEmail,
} from "./smtp-email-delivery";
import type {
  ContactMessageDelivery,
  EmailCodeDelivery,
  TeamInviteEmailDelivery,
  WelcomeEmailDelivery,
  WorkerBindings,
} from "./types";

export class EmailDeliveryError extends Schema.TaggedError<EmailDeliveryError>()("EmailDeliveryError", {
  message: Schema.String,
}) {}

export type EmailDeliveryBindings = Pick<
  WorkerBindings,
  | "EMAIL_SMTP_HOST"
  | "EMAIL_SMTP_PORT"
  | "EMAIL_SMTP_USERNAME"
  | "EMAIL_SMTP_PASSWORD"
  | "EMAIL_FROM"
  | "EMAIL_DELIVERY_WEBHOOK_URL"
  | "EMAIL_DELIVERY_WEBHOOK_SECRET"
>;

// The ambiguous results: the server may have taken the message, so it can count against the quota.
const UNKNOWN_DELIVERY_ERRORS = new Set(["smtp_delivery_unknown", "email_delivery_unknown"]);

export function createEmailCodeDelivery(
  bindings: EmailDeliveryBindings,
  analytics: AccountAnalytics,
): EmailCodeDelivery | null {
  const smtp = readSmtpConfig(bindings);
  if (smtp) {
    return {
      send: (message) => tracked(analytics, "sign_in_code", sendPrivateEmailCode(smtp, message)),
    };
  }

  const webhookUrl = bindings.EMAIL_DELIVERY_WEBHOOK_URL?.trim();
  if (!webhookUrl) return null;
  const url = new URL(webhookUrl);
  if (url.protocol !== "https:") {
    throw new Error("EMAIL_DELIVERY_WEBHOOK_URL must use HTTPS.");
  }
  const secret = bindings.EMAIL_DELIVERY_WEBHOOK_SECRET?.trim();
  const send = Effect.fn("EmailDelivery.sendCode")(function* (message: Parameters<EmailCodeDelivery["send"]>[0]) {
    const response = yield* Effect.tryPromise({
      try: (signal) =>
        fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(secret ? { Authorization: `Bearer ${secret}` } : {}) },
          body: JSON.stringify(message),
          signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
        }),
      catch: () => new EmailDeliveryError({ message: "email_delivery_unknown" }),
    });
    if (response.status === 429) return yield* new EmailDeliveryError({ message: RATE_LIMITED_DELIVERY_ERROR });
    if (!response.ok) return yield* new EmailDeliveryError({ message: "email_delivery_webhook_failed" });
  });
  return { send: (message) => tracked(analytics, "sign_in_code", send(message)) };
}

export function createTeamInviteEmailDelivery(
  bindings: EmailDeliveryBindings,
  analytics: AccountAnalytics,
): TeamInviteEmailDelivery | null {
  const smtp = readSmtpConfig(bindings);
  return smtp ? { send: (message) => tracked(analytics, "team_invite", sendPrivateTeamInvite(smtp, message)) } : null;
}

export function createContactMessageDelivery(
  bindings: EmailDeliveryBindings,
  analytics: AccountAnalytics,
): ContactMessageDelivery | null {
  const smtp = readSmtpConfig(bindings);
  return smtp ? { send: (message) => tracked(analytics, "contact", sendPrivateContactMessage(smtp, message)) } : null;
}

export function createWelcomeEmailDelivery(
  bindings: EmailDeliveryBindings,
  analytics: AccountAnalytics,
): WelcomeEmailDelivery | null {
  const smtp = readSmtpConfig(bindings);
  return smtp ? { send: (message) => tracked(analytics, "welcome", sendPrivateWelcomeEmail(smtp, message)) } : null;
}

/** Sends one `email_sent` event with the result of a send, so a dashboard can show the hourly quota use. */
function tracked<E extends { message: string }>(
  analytics: AccountAnalytics,
  kind: EmailKind,
  send: Effect.Effect<void, E>,
): Effect.Effect<void, E> {
  const track = (result: EmailResult) =>
    Effect.sync(() => analytics.track(EMAIL_DELIVERY_PROFILE_ID, { name: "email_sent", kind, result }));
  return send.pipe(
    Effect.tap(() => track("accepted")),
    Effect.tapError((error) => track(failedSendResult(error.message))),
  );
}

function failedSendResult(deliveryError: string): EmailResult {
  if (deliveryError === RATE_LIMITED_DELIVERY_ERROR) return "rate_limited";
  return UNKNOWN_DELIVERY_ERRORS.has(deliveryError) ? "unknown" : "failed";
}

function readSmtpConfig(bindings: EmailDeliveryBindings): SmtpEmailConfig | null {
  const values = {
    host: bindings.EMAIL_SMTP_HOST?.trim(),
    port: bindings.EMAIL_SMTP_PORT?.trim(),
    username: bindings.EMAIL_SMTP_USERNAME?.trim(),
    password: bindings.EMAIL_SMTP_PASSWORD,
    from: bindings.EMAIL_FROM?.trim(),
  };
  const configuredCount = Object.values(values).filter((value) => value !== undefined && value !== "").length;
  if (configuredCount === 0) return null;
  if (
    configuredCount !== Object.keys(values).length ||
    !values.host ||
    !values.port ||
    !values.username ||
    !values.password ||
    !values.from
  ) {
    throw new Error("SMTP email delivery configuration is incomplete.");
  }
  return {
    host: values.host,
    port: Number(values.port),
    username: values.username,
    password: values.password,
    from: values.from,
  };
}
