import { describe, expect, it } from "vitest";
import { dropPrompt, type PendingPrompt, reducePendingPrompts } from "./pending-prompts";

const asked = (requestId: string | number, agentId = "agent-1", turnId = "turn-1"): PendingPrompt => ({
  requestId,
  agentId,
  threadId: "thread-1",
  turnId,
  questions: [{ id: "q1", header: "Deploy", question: "Deploy now?", isSecret: false, options: null }],
});

describe("pending prompt requests", () => {
  it("adds a question that the host asks, with no message of the chat involved", () => {
    const next = reducePendingPrompts([], {
      type: "prompt",
      requestId: "r1",
      agentId: "agent-1",
      threadId: "thread-1",
      turnId: "turn-1",
      questions: [{ id: "q1", header: "Deploy", question: "Deploy now?", isSecret: false, options: null }],
    });
    expect(next.map((item) => String(item.requestId))).toEqual(["r1"]);
    expect(next[0]?.questions[0]?.question).toBe("Deploy now?");
  });

  it("replaces a repeated request instead of listing it twice", () => {
    const next = reducePendingPrompts([asked("r1")], {
      type: "prompt",
      requestId: "r1",
      agentId: "agent-1",
      threadId: "thread-1",
      turnId: "turn-1",
      questions: [{ id: "q1", header: "Deploy", question: "Deploy to production?", isSecret: false, options: null }],
    });
    expect(next).toHaveLength(1);
    expect(next[0]?.questions[0]?.question).toBe("Deploy to production?");
  });

  it("drops a question that the host resolved, and keeps the list when an approval resolved", () => {
    const current = [asked("r1"), asked("r2")];
    const answered = reducePendingPrompts(current, {
      type: "agent-input-resolved",
      kind: "prompt",
      requestId: "r1",
      agentId: "agent-1",
    });
    expect(answered.map((item) => String(item.requestId))).toEqual(["r2"]);
    const unrelated = reducePendingPrompts(current, {
      type: "agent-input-resolved",
      kind: "approval",
      requestId: "r1",
      agentId: "agent-1",
    });
    expect(unrelated).toBe(current);
  });

  it("drops the questions of a finished turn and keeps those of another agent", () => {
    const current = [asked("r1"), asked("r2", "agent-2"), asked("r3", "agent-1", "turn-2")];
    const next = reducePendingPrompts(current, {
      type: "turn-completed",
      agentId: "agent-1",
      threadId: "thread-1",
      turnId: "turn-1",
      status: "completed",
    });
    expect(next.map((item) => String(item.requestId))).toEqual(["r2", "r3"]);
  });

  it("removes an answered question from its own server only", () => {
    const byServer = { "server-a": [asked("r1"), asked("r2")], "server-b": [asked("r1")] };
    const next = dropPrompt(byServer, "server-a", "r1");
    expect(next["server-a"]?.map((item) => String(item.requestId))).toEqual(["r2"]);
    expect(next["server-b"]).toBe(byServer["server-b"]);
    expect(dropPrompt(byServer, "server-c", "r1")).toBe(byServer);
  });
});
