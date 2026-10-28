const platform = process.env.EXPO_OS ?? "unknown";

export const isIOS = platform === "ios";
export const isAndroid = platform === "android";

/** The Android long-press time in milliseconds. React Native waits 500 ms, and Android 400 ms. */
export const androidLongPressDelay = 400;
