import { type ConversationMessage, latestTurnAnswer, type QueueDelivery } from "@openbot/contracts/ipc";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { useEffect, useId, useRef, useState } from "react";
import { BackHandler } from "react-native";
import {
  cancelAnimation,
  Easing,
  ReduceMotion,
  type SharedValue,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { mobileAnalytics } from "@/features/analytics/mobile-analytics";
import { AUTOMATIC_DICTATION_LANGUAGE, useDictationLanguage } from "@/features/settings/model/dictation-language";
import { haptics } from "@/shared/lib/haptics";
import { speechSynthesis } from "@/shared/lib/speech-synthesis";
import { currentText } from "@/shared/lib/text";
import { type LiveConversationPhase, liveReplyTurn, liveSpeechParts } from "../model/live-conversation";
import type { OutboxMessage } from "../model/outbox";
import { useVoiceDictation, type VoiceDictation } from "./use-voice-dictation";

/** The pause after the last recognized words that ends the user's turn. */
const TURN_END_SILENCE_MS = 1_300;
/**
 * The agent's turn ended, or has not shown as running yet, and its answer is not in the
 * conversation: the read that the end starts brings it. After this long the conversation listens again.
 */
const REPLY_GRACE_MS = 5_000;
/** The phone's voice takes any length on iOS; Android has a limit near 4000 characters. */
const PART_LIMIT = 3_000;
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const OPEN_MS = 460;
const SPLIT_MS = 320;
const MERGE_MS = 180;
const CLOSE_MS = 400;
const SPEAKING_PULSE_MS = 420;

/** The message that was said, until the reply to it is read or dropped. */
interface PendingReply {
  clientMessageId: string;
  messageId: string | null;
  turnId: string | null;
  /** When the turn showed as ended with no answer yet. */
  endedAt: number | null;
}

interface LiveConversationInput {
  /** The chat is in front and the user can write here. */
  enabled: boolean;
  /** The agent's server is connected. */
  online: boolean;
  focused: boolean;
  foreground: boolean;
  /** The agent's conversation; null for a chat that has none, such as a channel. */
  conversation: { messages: readonly ConversationMessage[]; activeTurnId: string | null } | null;
  deliveries: readonly Pick<QueueDelivery, "messageId" | "turnId">[];
  outboxMessages: readonly OutboxMessage[];
  /** Sends what the user said. Null when the chat could not take it. */
  send: (text: string) => OutboxMessage | null;
}

interface LiveConversationState {
  open: boolean;
  phase: LiveConversationPhase;
  muted: boolean;
  caption: string;
  captionKey: number;
  error: string | null;
  exit: "cancel" | null;
}

const CLOSED: LiveConversationState = {
  open: false,
  phase: "starting",
  muted: false,
  caption: "",
  captionKey: 0,
  error: null,
  exit: null,
};

export interface LiveConversation extends LiveConversationState {
  /** The phone can listen and speak. */
  available: boolean;
  /** The voice that is heard now, from 0 to 1: the user's while listening, a pulse while speaking. */
  level: SharedValue<number>;
  /** 0 with the chat, 1 with the conversation. */
  presence: SharedValue<number>;
  /** 0 with one round button, 1 with End and Interrupt beside it. */
  split: SharedValue<number>;
  start: () => void;
  toggleMute: () => void;
  /** Stops the reply, or the wait for it, and listens again. The agent's turn goes on. */
  interrupt: () => void;
  end: () => void;
}

/**
 * A conversation by voice with one agent, as on desktop. It listens until the user stops speaking,
 * sends the words to the chat, waits for the agent's answer and reads it aloud with the phone's own
 * voice; then it listens again. Speech is recognized and read on the phone. The microphone is off
 * while the agent thinks or speaks, because the recognizer would hear the phone's own voice;
 * Interrupt stops the reply instead.
 */
export function useLiveConversation(input: LiveConversationInput): LiveConversation {
  const [state, setState] = useState(CLOSED);
  const inputRef = useRef(input);
  inputRef.current = input;
  const presence = useSharedValue(0);
  const split = useSharedValue(0);
  const speechLevel = useSharedValue(0);
  const dictationRef = useRef<VoiceDictation | null>(null);
  const [controller] = useState(() =>
    createController({
      input: () => inputRef.current,
      dictation: () => dictationRef.current,
      setState,
      presence,
      split,
      speechLevel,
    }),
  );
  const dictation = useVoiceDictation({
    enabled: input.enabled && input.online && state.open && !state.exit,
    onDraft: controller.hear,
  });
  dictationRef.current = dictation;
  const { conversation, deliveries, outboxMessages } = input;
  const available = dictation.available && Boolean(speechSynthesis) && conversation !== null;

  useEffect(() => {
    controller.followReply({ conversation, deliveries, outboxMessages });
  }, [controller, conversation, deliveries, outboxMessages]);

  useEffect(() => {
    controller.recognizerPhase(dictation.phase);
  }, [controller, dictation.phase]);

  useEffect(() => {
    controller.connection(input.online);
  }, [controller, input.online]);

  // The conversation belongs to the chat in front of an active app: a screen above the chat, or the
  // app in the background, ends it, as closing the pane does on desktop. Android reports the app as
  // in the background while its permission dialog is open, so the first start must not end itself.
  const asking = dictation.phase === "starting";
  useEffect(() => {
    if (state.open && (!input.focused || (!input.foreground && !asking))) controller.end();
  }, [controller, state.open, input.focused, input.foreground, asking]);

  // The user speaks hands-free, and a screen lock would put the app in the background.
  const keepAwakeTag = useId();
  useEffect(() => {
    if (!state.open) return;
    activateKeepAwakeAsync(keepAwakeTag).catch(() => {});
    return () => {
      deactivateKeepAwake(keepAwakeTag).catch(() => {});
    };
  }, [state.open, keepAwakeTag]);

  // Android back ends the conversation before it leaves the chat.
  useEffect(() => {
    if (!state.open || !input.focused) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      controller.end();
      return true;
    });
    return () => subscription.remove();
  }, [controller, state.open, input.focused]);

  useEffect(() => () => controller.dispose(), [controller]);

  return {
    ...state,
    available,
    level: state.phase === "speaking" ? speechLevel : dictation.level,
    presence,
    split,
    start: controller.start,
    toggleMute: controller.toggleMute,
    interrupt: controller.interrupt,
    end: controller.end,
  };
}

/**
 * The steps of the conversation. They read the newest input and recognizer through the getters, and
 * keep their own copies of the state: a state read shows a write only after the next render.
 */
function createController({
  input,
  dictation,
  setState,
  presence,
  split,
  speechLevel,
}: {
  input: () => LiveConversationInput;
  dictation: () => VoiceDictation | null;
  setState: (change: (current: LiveConversationState) => LiveConversationState) => void;
  presence: SharedValue<number>;
  split: SharedValue<number>;
  speechLevel: SharedValue<number>;
}) {
  let open = false;
  let exiting = false;
  let phase: LiveConversationPhase = "starting";
  let muted = false;
  let heard = "";
  let pending: PendingReply | null = null;
  /** Each turn, interruption and the end make the work of the turn before them stale. */
  let generation = 0;
  let pauseTimer: ReturnType<typeof setTimeout> | null = null;
  let graceTimer: ReturnType<typeof setTimeout> | null = null;
  /** The recognizer reached `listening` in this session: an end after that is not a failed start. */
  let sessionListened = false;
  let previousRecognizerPhase: VoiceDictation["phase"] = "idle";
  let startedAt = 0;
  let turns = 0;

  const update = (change: Partial<LiveConversationState>) => setState((current) => ({ ...current, ...change }));
  const setPhase = (next: LiveConversationPhase) => {
    phase = next;
    update({ phase: next });
  };
  const setMuted = (next: boolean) => {
    muted = next;
    update({ muted: next });
  };
  const newCaption = (caption: string) =>
    setState((current) => ({ ...current, caption, captionKey: current.captionKey + 1 }));

  function clearTimers(): void {
    if (pauseTimer) clearTimeout(pauseTimer);
    if (graceTimer) clearTimeout(graceTimer);
    pauseTimer = null;
    graceTimer = null;
  }

  function stopSpeaking(): void {
    cancelAnimation(speechLevel);
    speechLevel.set(0);
    void speechSynthesis?.stop().catch(() => {});
  }

  /** Ends the current turn's work: its recognizer session, its reply and its timers. */
  function drop(): void {
    generation += 1;
    clearTimers();
    stopSpeaking();
    pending = null;
  }

  /** Opens the microphone for the user's next turn, unless it is muted. */
  function listen(): void {
    drop();
    heard = "";
    setPhase("listening");
    newCaption("");
    if (muted || !open) return;
    sessionListened = false;
    if (!dictation()?.start("")) setMuted(true);
  }

  /** The user paused: the words so far are the turn. */
  function endTurn(): void {
    if (!open || phase !== "listening") return;
    clearTimers();
    setPhase("sending");
    const own = generation;
    void dictation()
      ?.finish()
      .then(() => {
        if (own === generation && open) deliver(heard.trim());
      });
  }

  function deliver(text: string): void {
    if (!text) {
      listen();
      return;
    }
    const message = input().send(text);
    if (!message) {
      listen();
      update({ caption: text, error: currentText().t("mobile.chat.liveVoice.notSent") });
      return;
    }
    turns += 1;
    pending = { clientMessageId: message.clientMessageId, messageId: message.messageId, turnId: null, endedAt: null };
    setPhase("thinking");
    update({ caption: text, error: null });
    followReply();
  }

  function speak(markdown: string): void {
    const synthesis = speechSynthesis;
    const parts = liveSpeechParts(markdown, Math.min(PART_LIMIT, synthesis?.maxSpeechInputLength ?? PART_LIMIT));
    if (!synthesis || parts.length === 0) {
      listen();
      return;
    }
    clearTimers();
    pending = null;
    const own = generation;
    setPhase("speaking");
    newCaption(parts[0] ?? "");
    speechLevel.set(
      withRepeat(
        withTiming(0.55, { duration: SPEAKING_PULSE_MS, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
        undefined,
        ReduceMotion.System,
      ),
    );
    // The reply is read in the dictation language when the user chose one, else in the phone's.
    const chosen = useDictationLanguage.getState().value;
    const language = chosen === AUTOMATIC_DICTATION_LANGUAGE ? undefined : chosen;
    parts.forEach((part, index) => {
      synthesis.speak(part, {
        ...(language ? { language } : {}),
        onStart: () => {
          if (own === generation && index > 0) newCaption(part);
        },
        onDone: () => {
          if (index === parts.length - 1 && own === generation && open) listen();
        },
        onError: () => {
          if (own !== generation || !open) return;
          listen();
          update({ error: currentText().t("mobile.chat.liveVoice.speakFailed") });
        },
      });
    });
  }

  /**
   * Follows the message that was said to the turn that answers it, and reads the answer when the
   * turn ends. A message that the outbox could not send ends the wait.
   */
  function followReply(
    {
      conversation,
      deliveries,
      outboxMessages,
    }: Pick<LiveConversationInput, "conversation" | "deliveries" | "outboxMessages"> = input(),
  ): void {
    const current = pending;
    if (!current || !conversation || phase !== "thinking") return;
    const outboxMessage = outboxMessages.find((message) => message.clientMessageId === current.clientMessageId);
    if (outboxMessage && (outboxMessage.state === "failed" || outboxMessage.returned || outboxMessage.stopped)) {
      listen();
      update({ caption: outboxMessage.text, error: currentText().t("mobile.chat.liveVoice.notSent") });
      return;
    }
    current.messageId = outboxMessage?.messageId ?? current.messageId;
    current.turnId ??= current.messageId ? liveReplyTurn(conversation.messages, deliveries, current.messageId) : null;
    const turnId = current.turnId;
    if (!turnId || conversation.activeTurnId === turnId) {
      current.endedAt = null;
      if (graceTimer) clearTimeout(graceTimer);
      graceTimer = null;
      return;
    }
    const answer = latestTurnAnswer(conversation.messages, turnId);
    if (answer?.status === "completed") {
      speak(answer.text);
      return;
    }
    // A stopped or failed answer is not read, as on desktop.
    if (answer && answer.status !== "streaming") {
      listen();
      return;
    }
    if (current.endedAt !== null) return;
    current.endedAt = Date.now();
    const own = generation;
    graceTimer = setTimeout(() => {
      if (own === generation && pending === current) listen();
    }, REPLY_GRACE_MS);
  }

  /**
   * The recognizer can end without a pause: Android ends a session at a silence, iOS at its time
   * limit, and an error or a denied permission ends it too. Words said so far are the turn; a
   * session that never listened mutes the microphone, and its alert explains why.
   */
  function recognizerPhase(next: VoiceDictation["phase"]): void {
    const before = previousRecognizerPhase;
    previousRecognizerPhase = next;
    if (next === "listening") sessionListened = true;
    if (next !== "idle" || before === "idle") return;
    if (!open || exiting || phase !== "listening" || muted || !input().online) return;
    if (heard.trim()) {
      clearTimers();
      setPhase("sending");
      deliver(heard.trim());
    } else if (sessionListened && input().enabled && input().foreground) listen();
    else setMuted(true);
  }

  /** No reply comes while the server is away, so the conversation stops until it is back. */
  function connection(online: boolean): void {
    if (!open || exiting) return;
    if (!online && phase !== "offline") {
      drop();
      dictation()?.cancel();
      setPhase("offline");
      newCaption("");
      update({ error: currentText().t("mobile.chat.liveVoice.offline") });
    } else if (online && phase === "offline") {
      update({ error: null });
      listen();
    }
  }

  function closed(): void {
    open = false;
    exiting = false;
    setState(() => CLOSED);
  }

  return {
    /** The words the recognizer heard in this session so far. */
    hear(text: string): void {
      if (!open || phase !== "listening") return;
      heard = text;
      update({ caption: text });
      if (pauseTimer) clearTimeout(pauseTimer);
      pauseTimer = text.trim() ? setTimeout(endTurn, TURN_END_SILENCE_MS) : null;
    },
    followReply,
    recognizerPhase,
    connection,
    start(): void {
      const { conversation, enabled, online } = input();
      if (open || !speechSynthesis || !conversation || !enabled) return;
      open = true;
      exiting = false;
      muted = false;
      startedAt = performance.now();
      turns = 0;
      setState(() => ({ ...CLOSED, open: true }));
      void haptics.impact("light");
      mobileAnalytics.track("voice_conversation_action", {
        action: "start",
        server_kind: "remote",
        result: "succeeded",
      });
      presence.set(withTiming(1, { duration: OPEN_MS, easing: EASE_OUT, reduceMotion: ReduceMotion.System }));
      // End and Interrupt come out of the round button once it has formed.
      split.set(
        withDelay(
          OPEN_MS,
          withTiming(1, { duration: SPLIT_MS, easing: EASE_OUT, reduceMotion: ReduceMotion.System }),
          ReduceMotion.System,
        ),
      );
      // Started while the server is away, it waits for the server as it would after a disconnect.
      if (online) listen();
      else {
        phase = "listening";
        connection(false);
      }
    },
    toggleMute(): void {
      if (!open || exiting) return;
      setMuted(!muted);
      void haptics.selection();
      if (phase !== "listening") return;
      if (muted) {
        generation += 1;
        clearTimers();
        dictation()?.cancel();
        heard = "";
        newCaption("");
      } else {
        update({ error: null });
        listen();
      }
    },
    interrupt(): void {
      if (!open || exiting || (phase !== "thinking" && phase !== "speaking")) return;
      void haptics.impact("light");
      listen();
    },
    end(): void {
      if (!open || exiting) return;
      exiting = true;
      drop();
      dictation()?.cancel();
      update({ exit: "cancel" });
      void haptics.selection();
      mobileAnalytics.track("voice_conversation_action", {
        action: "end",
        server_kind: "remote",
        result: "succeeded",
        duration_ms: performance.now() - startedAt,
        turn_count: turns,
      });
      // The side buttons go back into the circle first, then the circle opens into the composer.
      split.set(withTiming(0, { duration: MERGE_MS, easing: EASE_OUT, reduceMotion: ReduceMotion.System }));
      presence.set(
        withDelay(
          MERGE_MS / 2,
          withTiming(0, { duration: CLOSE_MS, easing: EASE_OUT, reduceMotion: ReduceMotion.System }, (finished) => {
            if (finished) scheduleOnRN(closed);
          }),
          ReduceMotion.System,
        ),
      );
    },
    dispose(): void {
      if (open) stopSpeaking();
      generation += 1;
      clearTimers();
      open = false;
    },
  };
}
