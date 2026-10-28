import { SUPERTONIC_MODEL_DIRECTORY, SUPERTONIC_MODEL_FILES } from "@openbot/contracts/speech-models";
import { Directory, File } from "expo-file-system";
import { create } from "zustand";
import { speechNative } from "./speech-native";

/** The download size of all files of the model. */
export const SUPERTONIC_MODEL_BYTES = SUPERTONIC_MODEL_FILES.reduce((total, file) => total + file.bytes, 0);

type ModelPhase = "unknown" | "missing" | "downloading" | "ready" | "error";

interface ModelState {
  phase: ModelPhase;
  /** 0 to 1 while it downloads. */
  progress: number;
  /** Why the last download failed: a network failure, a file that did not match, or no room. */
  failure: "download" | "verify" | null;
}

export const useSupertonicModel = create<ModelState>(() => ({ phase: "unknown", progress: 0, failure: null }));

/**
 * The model lives where the phone does not clear it when it needs room and does not back it up, so
 * the download stays until the user removes it in Settings. A verified file is marked, so the check
 * at startup does not hash 145 MB again. Without the native module there is no model to keep.
 */
function modelDirectory(): Directory | null {
  return speechNative ? new Directory(speechNative.modelRoot(), SUPERTONIC_MODEL_DIRECTORY) : null;
}

function markerOf(directory: Directory): File {
  return new File(directory, ".verified");
}

/** The model directory as a file URI, for the native module. Null until the model is ready. */
export function supertonicModelUri(): string | null {
  return useSupertonicModel.getState().phase === "ready" ? (modelDirectory()?.uri ?? null) : null;
}

/** Reads whether the model is on the phone, once at startup and after a removal. */
export function checkSupertonicModel(): void {
  const directory = modelDirectory();
  const ready =
    directory !== null &&
    markerOf(directory).exists &&
    SUPERTONIC_MODEL_FILES.every((file) => new File(directory, file.name).exists);
  if (useSupertonicModel.getState().phase !== "downloading")
    useSupertonicModel.setState({ phase: ready ? "ready" : "missing", progress: ready ? 1 : 0 });
}

let download: AbortController | null = null;

/**
 * Downloads the files that are missing or do not match their pinned SHA-256, the same files desktop
 * downloads. The phone keeps a file that matches, so a download that stopped goes on from there.
 */
export async function downloadSupertonicModel(): Promise<void> {
  const directory = modelDirectory();
  if (download || !directory) return;
  const controller = new AbortController();
  download = controller;
  useSupertonicModel.setState({ phase: "downloading", progress: 0, failure: null });
  let done = 0;
  try {
    directory.create({ intermediates: true, idempotent: true });
    if (markerOf(directory).exists) markerOf(directory).delete();
    for (const item of SUPERTONIC_MODEL_FILES) {
      const file = new File(directory, item.name);
      if (!(file.exists && file.size === item.bytes && (await file.digest("SHA-256")) === item.sha256)) {
        const partial = new File(directory, `${item.name}.download`);
        if (partial.exists) partial.delete();
        await File.downloadFileAsync(item.url, partial, {
          idempotent: true,
          signal: controller.signal,
          onProgress: ({ bytesWritten }) =>
            useSupertonicModel.setState({ progress: (done + bytesWritten) / SUPERTONIC_MODEL_BYTES }),
        });
        if ((await partial.digest("SHA-256")) !== item.sha256) {
          partial.delete();
          useSupertonicModel.setState({ phase: "error", failure: "verify" });
          return;
        }
        if (file.exists) file.delete();
        await partial.move(file);
      }
      done += item.bytes;
      useSupertonicModel.setState({ progress: done / SUPERTONIC_MODEL_BYTES });
    }
    markerOf(directory).create();
    useSupertonicModel.setState({ phase: "ready", progress: 1 });
  } catch {
    useSupertonicModel.setState(
      controller.signal.aborted ? { phase: "missing", progress: 0 } : { phase: "error", failure: "download" },
    );
  } finally {
    download = null;
  }
}

/** Stops a download. The files that finished stay, so the next download goes on from them. */
export function cancelSupertonicDownload(): void {
  download?.abort();
}

/** Deletes the model from the phone. The native module lets go of its files first. */
export async function removeSupertonicModel(): Promise<void> {
  cancelSupertonicDownload();
  await speechNative?.unload();
  const directory = modelDirectory();
  if (directory?.exists) directory.delete();
  useSupertonicModel.setState({ phase: "missing", progress: 0, failure: null });
}
