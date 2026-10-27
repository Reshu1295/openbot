import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { readFcmServiceAccount } from "../apps/auth-api/src/server/android-notification-relay";

const logger = createOpenBotLogger("deploy-auth-api");

const scriptsRoot = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(scriptsRoot, "..");
const apiRoot = join(projectRoot, "apps", "auth-api");
const executableSuffix = process.platform === "win32" ? ".exe" : "";
const bunExecutable = process.execPath;
// Bun installs the workspace binaries at the repository root.
const wranglerExecutable = join(projectRoot, "node_modules", ".bin", `wrangler${executableSuffix}`);

interface SecretWrite {
  name: string;
  value: string;
}

interface DeploymentPlan {
  secretWrites: SecretWrite[];
  omittedGroups: string[];
}

async function main(): Promise<void> {
  const cloudflareEnvironment = readCloudflareEnvironment(process.argv.slice(2));
  const environmentArgs = cloudflareEnvironment ? ["--env", cloudflareEnvironment] : [];
  const plan = createDeploymentPlan(cloudflareEnvironment);
  await run(bunExecutable, ["run", "build"], {
    label: "Auth API build",
    env: cloudflareEnvironment ? { CLOUDFLARE_ENV: cloudflareEnvironment } : undefined,
  });
  for (const group of plan.omittedGroups) logger.info(group);
  for (const secret of plan.secretWrites) {
    await run(wranglerExecutable, ["secret", "put", secret.name, ...environmentArgs], {
      input: `${secret.value}\n`,
      label: `${secret.name} secret`,
    });
  }
  await run(wranglerExecutable, ["d1", "migrations", "apply", "DB", "--remote", ...environmentArgs], {
    label: "Remote D1 migrations",
  });
  await run(wranglerExecutable, ["deploy", "--keep-vars", ...environmentArgs], {
    label: "Auth API deployment",
  });
}

function createDeploymentPlan(cloudflareEnvironment: string | null): DeploymentPlan {
  const secretWrites: SecretWrite[] = [];
  const omittedGroups: string[] = [];
  const addRequired = (name: string) => secretWrites.push({ name, value: requiredSecret(name) });
  const addOptional = (name: string) => {
    if (process.env[name]?.trim()) addRequired(name);
  };
  /**
   * Billing and hosting are optional: the Worker turns each off without its secrets.
   * Set all or none of a set. A Stripe or boat key without its webhook secret takes payments or makes
   * sandboxes that the Worker never sees.
   */
  const addOptionalSet = (names: string[]) => {
    const present = names.filter((name) => process.env[name]?.trim());
    if (present.length === 0) {
      omittedGroups.push(`${names.join(", ")} are not set. The Worker keeps its current values.`);
      return;
    }
    if (present.length !== names.length) {
      throw new Error(`Set all of ${names.join(", ")} in the decrypted production environment, or none.`);
    }
    for (const name of names) addRequired(name);
  };

  // Check both values before any remote change. Test Workers do not send account analytics.
  const productionAnalytics = cloudflareEnvironment
    ? []
    : ["OPENPANEL_CLIENT_ID", "OPENPANEL_CLIENT_SECRET"].map((name) => ({ name, value: requiredSecret(name) }));
  if (!cloudflareEnvironment) assertLandingBeam();
  assertFcmServiceAccount();
  addRequired("EMAIL_SMTP_PASSWORD");
  addRequired("SKILLS_ADMIN_TOKEN");
  addRequired("SITE_REPORT_HASH_SECRET");
  addRequired("REMOTE_TICKET_PRIVATE_JWK");
  addRequired("REMOTE_TICKET_PUBLIC_JWKS");
  addRequired("REMOTE_AUTH_WEBHOOK_SECRET");
  assertStripeKeyMode(cloudflareEnvironment);
  addOptionalSet(["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"]);
  addOptionalSet(["BOAT_API_KEY", "BOAT_WEBHOOK_SECRET"]);
  // Production releases own the template. Test deployments keep their separate setting.
  if (cloudflareEnvironment === "test") addOptional("HOSTED_SERVER_TEMPLATE");
  // Without the key, agents act on GitHub as the signed-in user and not as the OpenBot GitHub App.
  addOptional("GITHUB_APP_PRIVATE_KEY");
  // Without the token, no one can make a server claim.
  addOptional("SERVER_CLAIMS_ADMIN_TOKEN");
  // Slack is optional: without these, the Slack routes answer 503 slack_not_configured. The test
  // Worker takes the development app's values from the .env.dev file.
  addOptionalSet(["SLACK_CLIENT_ID", "SLACK_CLIENT_SECRET", "SLACK_STATE_SECRET"]);
  addOptionalSet(["SLACK_ROUTE_PRIVATE_JWK", "SLACK_ROUTE_KEY_ID"]);
  // Discord is optional too: without these, the Discord routes answer 503 discord_not_configured.
  addOptionalSet(["DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET", "DISCORD_STATE_SECRET"]);
  addOptionalSet(["DISCORD_ROUTE_PRIVATE_JWK", "DISCORD_ROUTE_KEY_ID"]);
  // Telegram too: without these, the routes answer 503. The bot token belongs to Signal.
  addOptionalSet(["TELEGRAM_BOT_ID", "TELEGRAM_BOT_USERNAME"]);
  if (cloudflareEnvironment === "test") {
    const allowList = testAllowListValue();
    if (allowList) secretWrites.push({ name: "HOSTED_SERVERS_ALLOWED_USER_IDS", value: allowList });
    else omittedGroups.push("HOSTED_SERVERS_TEST_ALLOW_LIST is not set. The Worker keeps its current allow list.");
    // The key is in the encrypted .env.dev file. Each developer who can decrypt it can create servers.
    addOptional("HOSTED_SERVERS_DEVELOPER_KEY");
  }
  if (!cloudflareEnvironment) secretWrites.push(...productionAnalytics);
  // The Live Activity relay stays off until the Apple key is in the environment.
  addOptionalSet(["APNS_PRIVATE_KEY", "APNS_KEY_ID"]);
  // The Android notification relay stays off until the Firebase service account key is in the environment.
  addOptional("FCM_SERVICE_ACCOUNT");
  return { secretWrites, omittedGroups };
}

// The build drops the home page beam when the private port is missing. Production always has it.
function assertLandingBeam(): void {
  const port = join(apiRoot, "src", "vendor", "laser-flow", "LandingLaserFlow.tsx");
  if (existsSync(port)) return;
  throw new Error(
    "The home page beam is missing. Clone nightly-labs/openbot-laser-flow into apps/auth-api/src/vendor/laser-flow.",
  );
}

function requiredSecret(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) throw new Error(`${name} is missing from the decrypted production environment.`);
  // dotenvx keeps the ciphertext when .env.keys has no matching private key.
  if (value.startsWith("encrypted:"))
    throw new Error(`${name} is not decrypted. Check the environment decryption key.`);
  return value;
}

/** A key that the Worker cannot read turns the relay off, so it stops the deployment before remote changes. */
function assertFcmServiceAccount(): void {
  const value = process.env.FCM_SERVICE_ACCOUNT?.trim();
  if (!value) return;
  if (value.startsWith("encrypted:"))
    throw new Error("FCM_SERVICE_ACCOUNT is not decrypted. Check the environment decryption key.");
  if (!readFcmServiceAccount(value)) throw new Error("FCM_SERVICE_ACCOUNT is not a Firebase service account key file.");
}

/** A test Worker must never take real payments, and production must never take test payments. */
function assertStripeKeyMode(cloudflareEnvironment: string | null): void {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) return;
  const live = key.startsWith("sk_live_") || key.startsWith("rk_live_");
  if (cloudflareEnvironment && live) {
    throw new Error(`STRIPE_SECRET_KEY is a live key. The ${cloudflareEnvironment} Worker takes only test keys.`);
  }
  if (!cloudflareEnvironment && !live)
    throw new Error("STRIPE_SECRET_KEY is not a live key. Production takes only live keys.");
}

/**
 * The test Worker is public and shares its boat account with production, so only the accounts in
 * the encrypted `HOSTED_SERVERS_TEST_ALLOW_LIST` (account IDs or emails), and a request with the
 * developer key, can create servers there. Production allows each account with a var in
 * wrangler.jsonc, and a var and a secret cannot have one name.
 */
function testAllowListValue(): string | undefined {
  const value = process.env.HOSTED_SERVERS_TEST_ALLOW_LIST?.trim();
  if (!value) return undefined;
  if (value.startsWith("encrypted:")) throw new Error("HOSTED_SERVERS_TEST_ALLOW_LIST is not decrypted.");
  if (value.split(",").some((entry) => entry.trim() === "*")) {
    throw new Error("HOSTED_SERVERS_TEST_ALLOW_LIST must name accounts, not `*`.");
  }
  return value;
}

async function run(
  executable: string,
  args: string[],
  options: { env?: NodeJS.ProcessEnv | undefined; input?: string; label: string },
): Promise<void> {
  await new Promise<void>((resolveProcess, rejectProcess) => {
    const environment = { ...process.env, ...options.env };
    if (executable === wranglerExecutable) delete environment.CLOUDFLARE_API_TOKEN;
    const child = spawn(executable, args, {
      cwd: apiRoot,
      env: environment,
      shell: false,
      stdio: [options.input === undefined ? "inherit" : "pipe", "inherit", "inherit"],
    });
    child.once("error", rejectProcess);
    child.once("exit", (code, signal) => {
      if (code === 0) resolveProcess();
      else {
        rejectProcess(new Error(`${options.label} failed with ${signal ? `signal ${signal}` : `code ${code ?? 1}`}.`));
      }
    });
    if (options.input !== undefined) child.stdin?.end(options.input);
  });
}

function readCloudflareEnvironment(args: string[]): string | null {
  if (args.length === 0) return null;
  if (args.length === 2 && args[0] === "--env" && /^[a-z0-9-]+$/u.test(args[1] ?? "")) {
    return args[1] ?? null;
  }
  throw new Error("Use --env followed by a lowercase Cloudflare environment name.");
}

void main().catch((error) => {
  logger.error("Auth API deployment failed.", toLogValue(error));
  process.exitCode = 1;
});
