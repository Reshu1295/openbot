import { requireOptionalNativeModule } from "expo";

/**
 * The system text-to-speech of the phone, or null where the native module is missing: Expo Go, or an
 * app binary from before the module, which an update can still reach. The package entry requires the
 * module and would crash there on import, so the chat hides the voice conversation instead.
 */
export const speechSynthesis: typeof import("expo-speech") | null = requireOptionalNativeModule("ExpoSpeech")
  ? require("expo-speech")
  : null;
