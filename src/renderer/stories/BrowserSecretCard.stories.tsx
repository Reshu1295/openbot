import type { BrowserTakeoverRequest } from "@openbot/contracts/ipc";
import { Button } from "@openbot/ui";
import { BrowserSecretCard } from "@openbot/ui/features/conversation/BrowserSecretCard";
import { createStore } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import browserTakeoverPreviewUrl from "./assets/browser-takeover-preview.svg";

const request: BrowserTakeoverRequest = {
  requestId: "authentication",
  agentId: "chief",
  threadId: "thread-chief",
  turnId: "turn-auth",
  tabId: "tab-auth",
  secret: { method: "otp", origin: "https://accounts.example.com", digits: 6 },
};
const passwordRequest: BrowserTakeoverRequest = {
  ...request,
  secret: { method: "password", origin: "https://accounts.example.com", digits: 6 },
};
const defaultArgs = {
  request,
  onRespond: async () => undefined,
  onOpen: () => undefined,
  loadPreview: async () => ({ dataUrl: browserTakeoverPreviewUrl, width: 960, height: 600 }),
};
const meta = {
  title: "Conversation/BrowserSecretCard",
  component: BrowserSecretCard,
  args: defaultArgs,
  render: (args) => <BrowserSecretCard {...defaultArgs} {...args} />,
  decorators: [
    (Story) => (
      <main class="foundation-story">
        <Story />
      </main>
    ),
  ],
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta<typeof BrowserSecretCard>;
export default meta;
type Story = StoryObj<typeof meta>;

export const OneTimeCode: Story = {};
export const Authenticator: Story = {
  args: {
    request: { ...request, secret: { method: "authenticator", origin: "https://accounts.example.com", digits: 6 } },
  },
};
export const Password: Story = {
  args: { request: passwordRequest },
  render: (args) => <BrowserSecretCard {...defaultArgs} {...args} request={passwordRequest} />,
};
export const EightDigits: Story = {
  args: { request: { ...request, secret: { method: "otp", origin: "https://accounts.example.com", digits: 8 } } },
};
export const Failed: Story = {
  args: {
    onRespond: async () => {
      throw new Error("Request unavailable.");
    },
  },
};
const renderNarrow: NonNullable<Story["render"]> = (args) => (
  <div style={{ width: "280px", "max-width": "100%" }}>
    <BrowserSecretCard {...defaultArgs} {...args} />
  </div>
);

export const Narrow: Story = { render: renderNarrow };

export const TwelveDigitsNarrow: Story = {
  args: { request: { ...request, secret: { method: "otp", origin: "https://accounts.example.com", digits: 12 } } },
  render: renderNarrow,
};

export const PreviewUnavailable: Story = {
  args: {
    loadPreview: async () => {
      throw new Error("Preview unavailable.");
    },
  },
};

export const SubmittingPassword: Story = {
  args: { ...Password.args, onRespond: () => new Promise<void>(() => {}) },
};

export const SubmittingCode: Story = {
  args: { onRespond: () => new Promise<void>(() => {}) },
};

export const Island: Story = {
  args: { variant: "island" },
};

export const IslandAuthenticator: Story = {
  args: { ...Authenticator.args, variant: "island" },
};

export const IslandPassword: Story = {
  args: { ...Password.args, variant: "island" },
};

export const IslandEightDigits: Story = {
  args: { ...EightDigits.args, variant: "island" },
};

export const IslandFailed: Story = {
  args: { ...Failed.args, variant: "island" },
};

export const IslandSubmittingCode: Story = {
  args: { ...SubmittingCode.args, variant: "island" },
};

export const IslandNarrow: Story = {
  args: { variant: "island" },
  render: renderNarrow,
};

/** Local saving keeps the existing checked default. */
export const LocalVaultPassword: Story = {
  args: { ...Password.args, vaultSave: true, vaultScope: "local" },
  render: (args) => (
    <BrowserSecretCard {...defaultArgs} {...args} request={passwordRequest} vaultSave vaultScope="local" />
  ),
};

/** Saving on the connected host requires explicit consent and shows the shared-agent scope. */
export const ServerVaultPassword: Story = {
  args: { ...Password.args, vaultSave: true, vaultScope: "server" },
  render: (args) => (
    <BrowserSecretCard {...defaultArgs} {...args} request={passwordRequest} vaultSave vaultScope="server" />
  ),
};

export const ServerVaultPasswordIsland: Story = {
  args: { ...ServerVaultPassword.args, variant: "island" },
  render: (args) => (
    <BrowserSecretCard
      {...defaultArgs}
      {...args}
      request={passwordRequest}
      vaultSave
      vaultScope="server"
      variant="island"
    />
  ),
};

/** Only response metadata is shown. A submitted password never enters the story's output. */
export const ServerVaultConsent: Story = {
  render: (args) => {
    const [state, setState] = createStore({
      request: 1,
      count: 0,
      decision: "none",
      saved: false,
      hasSave: false,
      fail: false,
    });
    return (
      <>
        <BrowserSecretCard
          {...meta.args}
          {...args}
          request={{
            ...request,
            requestId: `sample-password-${state.request}`,
            secret: { method: "password", origin: "https://accounts.example.com", digits: 6 },
          }}
          vaultSave
          vaultScope="server"
          onRespond={async (input) => {
            const fail = state.fail;
            setState((draft) => {
              draft.count += 1;
              draft.decision = input.decision;
              draft.saved = input.decision === "submit" && input.saveToVault === true;
              draft.hasSave = "saveToVault" in input;
              draft.fail = false;
            });
            if (fail) throw new Error("The sample host could not save the password.");
          }}
        />
        <section
          aria-label="Synthetic host controls"
          style={{ display: "grid", gap: "var(--openbot-space-3)", padding: "var(--openbot-space-4)" }}
        >
          <Button
            variant="outline"
            onClick={() =>
              setState((draft) => {
                draft.request += 1;
              })
            }
          >
            New password request
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              setState((draft) => {
                draft.fail = true;
              })
            }
          >
            Fail next response
          </Button>
          <output aria-label="Response metadata">
            {JSON.stringify({
              count: state.count,
              decision: state.decision,
              saveToVault: state.saved,
              hasSaveToVault: state.hasSave,
            })}
          </output>
        </section>
      </>
    );
  },
};
