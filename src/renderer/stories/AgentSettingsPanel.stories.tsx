import {
  type AgentFolderList,
  type AgentHostSettings,
  type BrowserProfileSummary,
  nextBrowserProfileHue,
  type ServerSummary,
  type UpdateAgentHostSettingsInput,
} from "@openbot/contracts/ipc";
import { Button, Text } from "@openbot/ui";
import type { AgentFolderCalls } from "@openbot/ui/features/conversation/AgentFolders";
import AgentSettingsPanel from "@openbot/ui/features/conversation/AgentSettingsPanel";
import { type ComponentProps, createMemo, createStore, untrack } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import {
  createRemoteAgentAdmin,
  type RemoteAgentAdminCalls,
  updateRemoteAgent,
} from "../src/features/agents/remote-agent-admin";
import { STORY_AGENT, STORY_AGENT_STATUS, STORY_MODELS, storyRuntimeSettings } from "./fixtures";

const defaultArgs = {
  agent: STORY_AGENT,
  runtimeSettings: storyRuntimeSettings(STORY_AGENT),
  agentStatus: STORY_AGENT_STATUS,
  modelOptions: STORY_MODELS,
  working: false,
  autoApprove: true,
  onUpdatePermissions: fn(async () => undefined),
  busyMessageModeEditable: true,
  newChatEditable: true,
  quickAcknowledgementEditable: true,
  browserProfiles: {
    profiles: [
      { id: "0a1b2c3d4e5f60718293a4b5c6d7e8f9", name: "Client A", hue: 215 },
      { id: "f9e8d7c6b5a4938271605f4e3d2c1b0a", name: "Client B", hue: 30 },
    ],
    onChange: fn(async () => undefined),
    onCreate: fn(async () => "1b2c3d4e5f60718293a4b5c6d7e8f90a"),
    onManage: fn(),
  },
  defaultBusyMessageMode: "queue",
  width: 296,
  maxWidth: () => 640,
  onClose: fn(),
  onStartNewChat: fn(async () => {}),
  onResize: fn(),
  onResizeEnd: fn(),
  onUpdateAgent: fn(async () => undefined),
  onUpdateRuntimeSettings: fn(async () => true),
  onSetAgentAvatar: fn(async () => undefined),
} satisfies ComponentProps<typeof AgentSettingsPanel>;

const meta = {
  title: "Settings/Shared Agent Form",
  component: AgentSettingsPanel,
  args: defaultArgs,
  render: (args) => (
    <main class="agent-memories-story-stage">
      <AgentSettingsPanel {...defaultArgs} {...args} />
    </main>
  ),
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta<typeof AgentSettingsPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Working: Story = { args: { working: true } };
export const WorkspaceOnly: Story = { args: { agent: { ...STORY_AGENT, access: "workspace" } } };

const STORY_FOLDERS: AgentFolderList = {
  workspace: "/Users/sam/OpenBot/Agents/Chief",
  shared: "/Users/sam/OpenBot/Shared",
  folders: [
    { path: "/Users/sam/Projects/Leads", found: true },
    { path: "/Users/sam/Documents/Contracts 2026", found: false },
  ],
};

function storyFolderCalls(): AgentFolderCalls {
  const change = async () => ({ outcome: "cancelled", list: STORY_FOLDERS }) as const;
  return {
    list: async () => STORY_FOLDERS,
    choose: change,
    add: change,
    remove: change,
    drop: change,
  };
}

/** Two added folders; one was moved, so the row and the Folders page say that it is not found. */
export const WorkspaceOnlyFolders: Story = {
  args: {
    agent: {
      ...STORY_AGENT,
      access: "workspace",
      additionalFolders: STORY_FOLDERS.folders.map((folder) => folder.path),
    },
    folders: storyFolderCalls(),
  },
};
/** Full reach, but the agent asks before it acts. */
export const AskFirst: Story = { args: { agent: { ...STORY_AGENT, access: "full" }, autoApprove: false } };
/** The agent steers messages sent while it works, whatever the app default says. */
export const SteersWhileWorking: Story = { args: { agent: { ...STORY_AGENT, busyMessageMode: "steer" } } };
/** Steer, from the app default, on a provider that cannot steer: the note says the messages queue. */
export const SteerUnsupportedProvider: Story = {
  args: {
    defaultBusyMessageMode: "steer",
    runtimeSettings: { provider: "opencode", model: STORY_AGENT.model, reasoningEffort: STORY_AGENT.reasoningEffort },
  },
};
/** An agent on a remote host: the setting belongs to that host, so the row is hidden. */
export const RemoteAgent: Story = {
  args: {
    onUpdatePermissions: undefined,
    busyMessageModeEditable: false,
    newChatEditable: false,
    quickAcknowledgementEditable: false,
    browserProfiles: undefined,
  },
};
/**
 * Advanced, then Browser profile, then New profile: the name field opens in the list. Add makes the
 * profile and gives it to the agent. "Client A" is taken.
 */
export const NewBrowserProfile: Story = {
  render: (args) => {
    const [profiles, setProfiles] = createStore<{ list: Pick<BrowserProfileSummary, "id" | "name" | "hue">[] }>({
      list: [
        { id: "0a1b2c3d4e5f60718293a4b5c6d7e8f9", name: "Client A", hue: 215 },
        { id: "f9e8d7c6b5a4938271605f4e3d2c1b0a", name: "Client B", hue: 30 },
      ],
    });
    return (
      <main class="agent-memories-story-stage">
        <AgentSettingsPanel
          {...defaultArgs}
          {...args}
          browserProfiles={{
            profiles: profiles.list,
            onChange: fn(async () => undefined),
            onCreate: async (name) => {
              if (profiles.list.some((profile) => profile.name.toLowerCase() === name.toLowerCase()))
                throw new Error("A profile with this name already exists.");
              const id = crypto.randomUUID().replaceAll("-", "");
              setProfiles((draft) => {
                draft.list.push({ id, name, hue: nextBrowserProfileHue(draft.list.map((profile) => profile.hue)) });
              });
              return id;
            },
            onManage: fn(),
          }}
        />
      </main>
    );
  },
};
/** An OpenCode model with no reasoning setting: OpenCode decides, and the row says so. */
export const ReasoningSetByProvider: Story = {
  args: {
    runtimeSettings: { provider: "opencode", model: "opencode/big-pickle", reasoningEffort: "medium" },
    modelOptions: [
      ...STORY_MODELS,
      {
        provider: "opencode",
        id: "opencode/big-pickle",
        name: "Big Pickle",
        description: "Free OpenCode model.",
        defaultReasoningEffort: "medium",
        supportedReasoningEfforts: ["medium"],
        reasoningEffortConfigurable: false,
      },
    ],
  },
};
export const SaveFailure: Story = {
  args: {
    onUpdateAgent: fn(async () => {
      throw new Error("Could not save agent settings. Try again.");
    }),
  },
};

/** Real remote controller and form, with a synthetic host that exposes its saved values. */
export const RemoteComputerUse: Story = {
  render: (args) => {
    const initialSettings = (computerUse: boolean): AgentHostSettings => ({
      computerUse,
      allowAutomation: false,
      busyMessageMode: null,
      defaultBusyMessageMode: "queue",
    });
    const [host, setHost] = createStore<{
      agentId: string;
      role: "owner" | "admin" | "member";
      supported: boolean;
      revision: number;
      holdRead: boolean;
      failRead: boolean;
      failWrite: boolean;
      reads: number;
      writes: number;
      profileWrites: number;
      values: Record<string, AgentHostSettings>;
      lastWrite: UpdateAgentHostSettingsInput | null;
      lastServer: string | null;
    }>({
      agentId: "remote-a",
      role: "owner",
      supported: true,
      revision: 0,
      holdRead: false,
      failRead: false,
      failWrite: false,
      reads: 0,
      writes: 0,
      profileWrites: 0,
      values: { "remote-a": initialSettings(false), "remote-b": initialSettings(true) },
      lastWrite: null,
      lastServer: null,
    });
    const heldReads: Array<() => void> = [];
    const server = createMemo<ServerSummary>(() => ({
      id: "sample-host",
      name: "Sample host",
      kind: "remote",
      state: "online",
      apiUrl: "https://host.example.com",
      logoUrl: null,
      notificationsMuted: false,
      notificationsMutedUntil: null,
      notificationLevel: "all",
      remoteDesktopAvailable: true,
      role: host.role,
      active: true,
      compatibility: {
        localAppVersion: "story",
        hostAppVersion: "story",
        localProtocol: { minimum: 3, maximum: 3 },
        hostProtocol: { minimum: 3, maximum: 3 },
        negotiatedProtocol: 3,
        capabilities: host.supported ? ["agent-host-settings-v1"] : [],
      },
    }));
    function settings(agentId: string): AgentHostSettings {
      return untrack(() => {
        const value = host.values[agentId];
        if (!value) throw new Error("The sample agent does not exist.");
        return { ...value };
      });
    }
    const calls: RemoteAgentAdminCalls = {
      getAgentHostSettings: async (agentId) => {
        const value = settings(agentId);
        const { hold, fail } = untrack(() => ({ hold: host.holdRead, fail: host.failRead }));
        setHost((draft) => {
          draft.reads += 1;
          draft.holdRead = false;
          draft.failRead = false;
        });
        if (fail) throw new Error("The sample host could not load settings.");
        if (hold) return new Promise<AgentHostSettings>((resolve) => heldReads.push(() => resolve(value)));
        return value;
      },
      updateAgentHostSettings: async (input, serverId) => {
        const fail = host.failWrite;
        setHost((draft) => {
          draft.writes += 1;
          draft.lastWrite = input;
          draft.lastServer = serverId ?? null;
          draft.failWrite = false;
        });
        if (fail) throw new Error("The sample host refused the update.");
        const next = settings(input.agentId);
        if (input.computerUse !== undefined) next.computerUse = input.computerUse;
        if (input.allowAutomation !== undefined) next.allowAutomation = input.allowAutomation;
        if (input.busyMessageMode !== undefined) next.busyMessageMode = input.busyMessageMode;
        setHost((draft) => {
          const saved = draft.values[input.agentId];
          if (!saved) throw new Error("The sample agent does not exist.");
          Object.assign(saved, next);
        });
        return next;
      },
      getAgentAdminSettings: async () => ({ access: "full", autoApprove: true, autoApproveLocked: false }),
      updateAgentAdminSettings: async () => ({ access: "full", autoApprove: true, autoApproveLocked: false }),
      getAgentBackupModels: async () => ({ backupModels: null, usageLimitReturn: null }),
      updateAgentBackupModels: async () => ({ backupModels: null, usageLimitReturn: null }),
      getAgentTaskLimit: async () => ({ taskLimit: null }),
      updateAgentTaskLimit: async () => ({ taskLimit: null }),
    };
    const admin = createRemoteAgentAdmin(
      () => ({ server: server(), agentId: host.agentId, updatedAt: String(host.revision) }),
      () => calls,
    );
    return (
      <main class="agent-memories-story-stage">
        <AgentSettingsPanel
          {...defaultArgs}
          {...args}
          agent={{
            ...STORY_AGENT,
            id: host.agentId,
            name: host.agentId === "remote-a" ? "Sample A" : "Sample B",
            computerUse: admin.computerUse(),
          }}
          onUpdatePermissions={undefined}
          computerUseEditable={admin.computerUse() !== undefined}
          automationEditable={false}
          browserProfiles={undefined}
          busyMessageModeEditable={false}
          newChatEditable={false}
          quickAcknowledgementEditable={false}
          onUpdateAgent={(agentId, updates) =>
            updateRemoteAgent(admin, { agentId, ...updates }, async () => {
              setHost((draft) => {
                draft.profileWrites += 1;
              });
            })
          }
        />
        <section
          aria-label="Synthetic host controls"
          style={{ display: "grid", gap: "var(--openbot-space-3)", padding: "var(--openbot-space-4)" }}
        >
          <Text as="p">This story uses a sample host and the real remote settings controller.</Text>
          <Button
            variant="outline"
            onClick={() =>
              setHost((draft) => {
                draft.role = "owner";
              })
            }
          >
            Use owner role
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              setHost((draft) => {
                draft.role = "admin";
              })
            }
          >
            Use admin role
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              setHost((draft) => {
                draft.role = "member";
              })
            }
          >
            Use member role
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              setHost((draft) => {
                draft.supported = !draft.supported;
              })
            }
          >
            Toggle host capability
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              setHost((draft) => {
                draft.holdRead = true;
              })
            }
          >
            Hold next host read
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              setHost((draft) => {
                draft.failRead = true;
              })
            }
          >
            Fail next host read
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              setHost((draft) => {
                draft.failWrite = true;
              })
            }
          >
            Fail next host update
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              setHost((draft) => {
                draft.revision += 1;
              })
            }
          >
            Reload host settings
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              for (const release of heldReads.splice(0)) release();
            }}
          >
            Release held host reads
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              setHost((draft) => {
                draft.agentId = draft.agentId === "remote-a" ? "remote-b" : "remote-a";
              })
            }
          >
            Switch sample agent
          </Button>
          <output aria-label="Synthetic host state">
            {JSON.stringify({
              agentId: host.agentId,
              role: host.role,
              supported: host.supported,
              hostComputerUse: host.values[host.agentId]?.computerUse,
              reads: host.reads,
              writes: host.writes,
              profileWrites: host.profileWrites,
              lastWrite: host.lastWrite,
              lastServer: host.lastServer,
            })}
          </output>
        </section>
      </main>
    );
  },
};
