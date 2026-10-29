import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  graphAgentIds,
  isWorkflowGraph,
  WORKFLOW_BRANCHES,
  WORKFLOW_NODE_KINDS,
  WORKFLOW_PORT_TYPES,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { RoutineInputError } from "@openbot/team-client/routine-schedule";
import { Effect } from "effect";
import { z } from "zod";
import { openBotToolFailure, openBotToolResult } from "../agent/routine-tools";
import { ToolOperationFailed } from "../agent/tool-operation";
import { routineScheduleZodSchema } from "../routine-tool-schema";
import { WorkflowStoreError } from "./workflow-store";
import { unsupportedNode } from "./workflow-walk";
import type { WorkflowsHandle } from "./workflows";

const identifier = z.string().min(1).max(INPUT_LIMITS.identifier);
const point = z.strictObject({ x: z.number(), y: z.number() });
const graph = z
  .strictObject({
    nodes: z
      .array(
        z.strictObject({
          id: identifier,
          kind: z.enum(WORKFLOW_NODE_KINDS.filter((kind) => kind !== "image" && kind !== "asset")),
          at: point,
          fields: z.object({}).catchall(z.union([z.string(), z.number(), z.boolean()])),
          schedule: routineScheduleZodSchema.optional(),
          size: z
            .strictObject({ width: z.number().optional(), height: z.number().optional(), font: z.number().optional() })
            .optional(),
          locked: z.boolean().optional(),
        }),
      )
      .max(INPUT_LIMITS.workflowNodes),
    edges: z
      .array(
        z.strictObject({
          id: identifier,
          from: identifier,
          to: identifier,
          type: z.enum(WORKFLOW_PORT_TYPES),
          branch: z.enum(WORKFLOW_BRANCHES).optional(),
        }),
      )
      .max(INPUT_LIMITS.workflowEdges),
    strokes: z
      .array(
        z.strictObject({
          id: identifier,
          brush: identifier,
          color: identifier,
          width: z.number(),
          points: z.array(point),
        }),
      )
      .max(INPUT_LIMITS.workflowStrokes),
  })
  .refine(isWorkflowGraph, "The workflow graph has invalid nodes, edges, fields, or limits.");
const listSchema = z.strictObject({});
const readSchema = z.strictObject({ workflowId: identifier });
const createSchema = z.strictObject({ title: z.string().trim().min(1).max(INPUT_LIMITS.workflowTitle), graph });

export type WorkflowTools = Pick<WorkflowsHandle, "list" | "get" | "create">;

export const WORKFLOW_TOOL_DEFINITIONS = [
  {
    name: "list_workflows",
    description: "List saved workflows on this host.",
    shape: listSchema.shape,
  },
  {
    name: "read_workflow",
    description: "Read a saved workflow by workflowId.",
    shape: readSchema.shape,
  },
  {
    name: "create_workflow",
    description:
      "Save a workflow graph on the Workflows page. Manual runs do not start; schedule triggers become active.",
    shape: createSchema.shape,
  },
] as const;

const NAMES = new Set<string>(WORKFLOW_TOOL_DEFINITIONS.map((tool) => tool.name));

/** Uses the canvas service, so graph rules, transactions, schedules and change events stay the same. */
export const handleWorkflowTool = Effect.fn("WorkflowTools.handle")(function* (
  tool: string,
  args: unknown,
  workflows: WorkflowTools | null,
  agentIds: ReadonlySet<string>,
  redact: (text: string) => string,
) {
  if (!NAMES.has(tool)) return null;
  if (!workflows) return openBotToolFailure("Workflows are unavailable on this host.");
  const operation = Effect.gen(function* () {
    if (tool === "list_workflows") {
      const parsed = listSchema.safeParse(args ?? {});
      if (!parsed.success) return openBotToolFailure(parsed.error.message);
      return openBotToolResult({ workflows: yield* workflows.list() });
    }
    if (tool === "read_workflow") {
      const parsed = readSchema.safeParse(args);
      if (!parsed.success) return openBotToolFailure(parsed.error.message);
      return openBotToolResult(yield* workflows.get(parsed.data.workflowId));
    }
    const parsed = createSchema.safeParse(args);
    if (!parsed.success) return openBotToolFailure(parsed.error.message);
    if (parsed.data.graph.nodes.some(unsupportedNode))
      return openBotToolFailure(sourceText("error.workflow.nodeUnsupported"));
    const unknownAgent = graphAgentIds(parsed.data.graph).find((id) => !agentIds.has(id));
    if (unknownAgent) return openBotToolFailure(`Unknown agent: ${unknownAgent}. Use list_agents for a current id.`);
    return openBotToolResult(yield* workflows.create(parsed.data));
  });
  return yield* operation.pipe(
    Effect.catchTag("WorkflowFailed", (failure) =>
      failure.cause instanceof WorkflowStoreError || failure.cause instanceof RoutineInputError
        ? Effect.succeed(openBotToolFailure(failure.cause.message))
        : Effect.fail(new ToolOperationFailed({ cause: failure.cause })),
    ),
    Effect.map((result) => ({
      ...result,
      contentItems: result.contentItems.map((item) => ({ ...item, text: redact(item.text) })),
    })),
  );
});
