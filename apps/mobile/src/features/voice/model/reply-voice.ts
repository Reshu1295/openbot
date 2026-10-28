import {
  isSpeechLanguage,
  SPEECH_LIMITS,
  SPEECH_VOICES,
  type SpeechLanguage,
  type SpeechVoice,
} from "@openbot/contracts/ipc";
import { speechLanguageOf } from "@openbot/contracts/speech-language";
import { SUPERTONIC_DENOISING_STEPS } from "@openbot/contracts/speech-models";
import { speechTextFromMarkdown } from "@openbot/contracts/speech-text";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import { liveSpeechParts } from "@/features/chat/model/live-conversation";
import { AUTOMATIC_DICTATION_LANGUAGE, useDictationLanguage } from "@/features/settings/model/dictation-language";
import { phoneLanguages } from "@/shared/lib/phone-languages";
import { ELEVENLABS_SAMPLE_RATE, ElevenLabsError, elevenLabsSpeech } from "./elevenlabs";
import { speechNative } from "./speech-native";
import { supertonicModel, useSupertonicModel } from "./supertonic-model";
import { type ElevenLabsVoice, readElevenLabsKey, useVoiceSettings } from "./voice-settings";

/** Supertonic 3 synthesizes faster with more threads, and a phone has four or more cores. */
const SUPERTONIC_THREADS = 4;

/** Why a reply was not read to its end. */
export type ReplyVoiceFailure = "not-ready" | "language" | "speech" | "invalid-key" | "permission" | "network";

/** What a surface says when a reply or a sample is not read to its end. */
export const REPLY_VOICE_FAILURE_TEXT = {
  "not-ready": "mobile.chat.liveVoice.voiceNotReady",
  language: "mobile.chat.liveVoice.languageUnsupported",
  speech: "mobile.chat.liveVoice.speakFailed",
  "invalid-key": "mobile.chat.liveVoice.elevenLabsKeyInvalid",
  permission: "mobile.chat.liveVoice.elevenLabsPermission",
  network: "mobile.chat.liveVoice.networkNeeded",
} as const satisfies Record<ReplyVoiceFailure, MobileTextKey>;

/** A voice to read with in place of the one in the settings, such as a voice the user previews. */
export type ReplyVoiceChoice =
  | { engine: "supertonic"; supertonicVoice: SpeechVoice }
  | { engine: "elevenlabs"; elevenLabsVoice: ElevenLabsVoice };

export interface ReplyReading {
  stop: () => void;
}

/** The chosen voice can read now: Supertonic 3 is downloaded, or ElevenLabs has a key and a voice. */
export function replyVoiceReady(engine = useVoiceSettings.getState().engine): boolean {
  if (!speechNative) return false;
  const settings = useVoiceSettings.getState();
  if (engine === "elevenlabs") return settings.hasElevenLabsKey && settings.elevenLabsVoice !== null;
  return useSupertonicModel.getState().phase === "ready";
}

/** The language a reply falls back to when its words do not show one: the dictation language, else the phone's. */
function fallbackLanguage(): SpeechLanguage {
  const chosen = useDictationLanguage.getState().value;
  const candidates = chosen === AUTOMATIC_DICTATION_LANGUAGE ? phoneLanguages() : [chosen];
  for (const locale of candidates) {
    const language = locale.split(/[-_]/)[0]?.toLowerCase();
    if (isSpeechLanguage(language)) return language;
  }
  return "en";
}

type Listener = { start: (id: string) => void; done: (id: string) => void; error: (id: string) => void };
const listeners = new Set<Listener>();
if (speechNative) {
  speechNative.addListener("onSpeechStart", ({ id }) => {
    for (const listener of listeners) listener.start(id);
  });
  speechNative.addListener("onSpeechDone", ({ id }) => {
    for (const listener of listeners) listener.done(id);
  });
  speechNative.addListener("onSpeechError", ({ id }) => {
    for (const listener of listeners) listener.error(id);
  });
}

function elevenLabsFailure(code: ElevenLabsError["code"]): ReplyVoiceFailure {
  if (code === "invalid-key" || code === "network") return code;
  return code === "failed" ? "speech" : "permission";
}

let nextReading = 0;

/**
 * Reads a Markdown reply aloud with the voice in the settings, one part at a time: code, tables and
 * addresses are not read, as on desktop. `onPart` gets the part that starts to play. One reading
 * plays at a time; a new one stops the one before it.
 */
export function readReply(
  markdown: string,
  handlers: { onPart: (text: string) => void; onDone: () => void; onError: (failure: ReplyVoiceFailure) => void },
  choice?: ReplyVoiceChoice,
): ReplyReading {
  const native = speechNative;
  const reading = ++nextReading;
  const abort = new AbortController();
  let ended = false;
  const parts = liveSpeechParts(markdown, SPEECH_LIMITS.maximumTextLength);
  const ids = parts.map((_, index) => `${reading}:${index}`);
  const end = (failure?: ReplyVoiceFailure) => {
    if (ended) return;
    ended = true;
    listeners.delete(listener);
    abort.abort();
    if (failure) {
      native?.stop();
      handlers.onError(failure);
    } else handlers.onDone();
  };
  const listener: Listener = {
    start: (id) => {
      const index = ids.indexOf(id);
      if (index >= 0 && !ended) handlers.onPart(parts[index] ?? "");
    },
    done: (id) => {
      if (id === ids.at(-1)) end();
    },
    error: (id) => {
      if (ids.includes(id)) end("speech");
    },
  };
  const stop = () => {
    if (ended) return;
    ended = true;
    listeners.delete(listener);
    abort.abort();
    native?.stop();
  };
  const settings = useVoiceSettings.getState();
  const engine = choice?.engine ?? settings.engine;
  const elevenLabsVoice = choice?.engine === "elevenlabs" ? choice.elevenLabsVoice : settings.elevenLabsVoice;
  const supertonicVoice = choice?.engine === "supertonic" ? choice.supertonicVoice : settings.supertonicVoice;
  const ready =
    engine === "elevenlabs" ? settings.hasElevenLabsKey && elevenLabsVoice !== null : replyVoiceReady("supertonic");
  if (!native || !ready) {
    queueMicrotask(() => end("not-ready"));
    return { stop };
  }
  if (parts.length === 0) {
    queueMicrotask(() => end());
    return { stop };
  }
  native.stop();
  listeners.add(listener);
  void (async () => {
    try {
      if (engine === "elevenlabs") {
        const key = await readElevenLabsKey();
        const voice = elevenLabsVoice;
        if (!key || !voice) return end("not-ready");
        // Each part plays while the next one is fetched.
        for (const [index, part] of parts.entries()) {
          const pcm = await elevenLabsSpeech(key, voice.id, part, abort.signal);
          if (ended) return;
          native.playPcm(ids[index] ?? "", pcm, ELEVENLABS_SAMPLE_RATE);
        }
        return;
      }
      const directory = supertonicModel.uri();
      if (!directory) return end("not-ready");
      // Supertonic 3 reads 31 languages; a reply in another script, such as Chinese, is not read.
      const language = speechLanguageOf(speechTextFromMarkdown(markdown), fallbackLanguage());
      if (!language) return end("language");
      await native.load(directory, SUPERTONIC_THREADS);
      if (ended) return;
      const speaker = SPEECH_VOICES.indexOf(supertonicVoice);
      for (const [index, part] of parts.entries())
        native.speak(ids[index] ?? "", part, language, speaker, SUPERTONIC_DENOISING_STEPS);
    } catch (error) {
      if (ended) return;
      end(error instanceof ElevenLabsError ? elevenLabsFailure(error.code) : "speech");
    }
  })();
  return { stop };
}
