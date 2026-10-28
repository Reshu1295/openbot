import { type NativeModule, requireOptionalNativeModule } from "expo";

type SpeechEvents = {
  onSpeechStart: (event: { id: string }) => void;
  onSpeechDone: (event: { id: string }) => void;
  onSpeechError: (event: { id: string; code: string }) => void;
};

declare class SpeechModule extends NativeModule<SpeechEvents> {
  /** A `file://` URI of the directory for downloaded voice models, which the device does not back up. */
  modelRoot(): string;
  /** Loads Supertonic 3 from its model directory. The same directory keeps the loaded model. */
  load(directory: string, threads: number): Promise<void>;
  unload(): Promise<void>;
  /** Reads one part of a reply with Supertonic 3, after the parts before it. */
  speak(id: string, text: string, language: string, speaker: number, steps: number): void;
  /** Plays little-endian 16-bit mono PCM after the parts before it. */
  playPcm(id: string, pcm: Uint8Array, sampleRate: number): void;
  /** Stops the part that plays and drops the parts that wait. */
  stop(): void;
}

/**
 * `modules/speech`: Supertonic 3 through sherpa-onnx, and the playback of every reply voice. Null in
 * a build without it, such as Expo Go or an app binary from before it, which an update can still
 * reach. The chat then keeps dictation and has no voice conversation.
 */
export const speechNative = requireOptionalNativeModule<SpeechModule>("OpenBotSpeech");
