import type { SpeechVoice } from "@openbot/contracts/ipc";
import type { MobileTranslate } from "@openbot/i18n/mobile";
import { router } from "expo-router";
import { Button, Typography } from "heroui-native";
import Check from "lucide-react-native/icons/check";
import { useEffect, useRef, useState } from "react";
import { Alert } from "react-native";
import { useCSSVariable } from "uniwind";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { haptics } from "@/shared/lib/haptics";
import { currentText, useText } from "@/shared/lib/text";
import { useVoicePreview } from "../components/use-voice-preview";
import { elevenLabsVoiceParts } from "../model/elevenlabs";
import { clearElevenLabsVoices, loadElevenLabsVoices, useElevenLabsVoices } from "../model/elevenlabs-voices";
import { speechNative } from "../model/speech-native";
import {
  cancelSupertonicDownload,
  downloadSupertonicModel,
  removeSupertonicModel,
  SUPERTONIC_MODEL_BYTES,
  useSupertonicModel,
} from "../model/supertonic-model";
import { removeElevenLabsKey, saveVoiceSettings, useVoiceSettings, type VoiceEngine } from "../model/voice-settings";

export function supertonicVoiceLabel(voice: SpeechVoice, t: MobileTranslate): string {
  const number = voice.slice(1);
  return voice.startsWith("F")
    ? t("mobile.settings.voice.supertonic.female", { number })
    : t("mobile.settings.voice.supertonic.male", { number });
}

/** What Supertonic 3 can do now, for its row in the choice of voice. */
function useSupertonicStatus(): string {
  const { t, format } = useText();
  const model = useSupertonicModel();
  const voice = useVoiceSettings((state) => state.supertonicVoice);
  const size = format.fileSize(SUPERTONIC_MODEL_BYTES);
  if (model.phase === "downloading")
    return t("mobile.settings.voice.supertonic.downloading", { percent: format.percent(model.progress) });
  if (model.phase === "ready")
    return t("mobile.settings.voice.engine.supertonicReady", { voice: supertonicVoiceLabel(voice, t) });
  if (model.phase === "error")
    return t(
      model.failure === "verify"
        ? "mobile.settings.voice.supertonic.verifyFailed"
        : "mobile.settings.voice.supertonic.downloadFailed",
    );
  return t("mobile.settings.voice.engine.supertonicMissing", { size });
}

/**
 * The choice of the voice that reads replies. The checked row is the voice in use; the settings of
 * that voice follow below it.
 */
function EngineSection({ onError }: { onError: (message: string) => void }) {
  const { t } = useText();
  const settings = useVoiceSettings();
  const supertonicStatus = useSupertonicStatus();
  const accent = String(useCSSVariable("--openbot-accent"));
  const mark = (engine: VoiceEngine) =>
    settings.engine === engine ? <Check size={18} color={accent} strokeWidth={2} /> : null;
  const elevenLabsStatus = !settings.hasElevenLabsKey
    ? t("mobile.settings.voice.engine.elevenLabsNoKey")
    : settings.elevenLabsVoice
      ? elevenLabsVoiceParts(settings.elevenLabsVoice.name).title
      : t("mobile.settings.voice.elevenLabs.chooseVoice");
  const choose = (engine: VoiceEngine) => {
    // ElevenLabs needs a key first; the key page makes it the voice in use when the key is saved.
    if (engine === "elevenlabs" && !settings.hasElevenLabsKey) {
      router.push("/settings/elevenlabs-key");
      return;
    }
    if (engine === settings.engine) return;
    void haptics.selection();
    void saveVoiceSettings({ engine }).catch(() => onError(t("mobile.settings.saveFailed")));
  };
  return (
    <SettingsSection title={t("mobile.settings.voice.engine.title")} footer={t("mobile.settings.voice.engine.footer")}>
      <SettingsRow
        checked={settings.engine === "supertonic"}
        disclosure={false}
        disabled={!settings.ready}
        supportingText={supertonicStatus}
        trailing={mark("supertonic")}
        onPress={() => choose("supertonic")}
      >
        <Typography.Paragraph>{t("mobile.settings.voice.engine.supertonic")}</Typography.Paragraph>
      </SettingsRow>
      <SettingsRow
        checked={settings.engine === "elevenlabs"}
        disclosure={false}
        disabled={!settings.ready}
        supportingText={elevenLabsStatus}
        trailing={mark("elevenlabs")}
        onPress={() => choose("elevenlabs")}
      >
        <Typography.Paragraph>{t("mobile.settings.voice.engine.elevenLabs")}</Typography.Paragraph>
      </SettingsRow>
    </SettingsSection>
  );
}

function ListenRow({ enabled, playing, onPress }: { enabled: boolean; playing: boolean; onPress: () => void }) {
  const { t } = useText();
  return (
    <SettingsRow disclosure={false} disabled={!enabled} onPress={onPress}>
      <Typography.Paragraph className="text-accent">
        {t(playing ? "mobile.settings.voice.stop" : "mobile.settings.voice.listen")}
      </Typography.Paragraph>
    </SettingsRow>
  );
}

function SupertonicSection({
  preview,
  onError,
}: {
  preview: ReturnType<typeof useVoicePreview>;
  onError: (message: string) => void;
}) {
  const { t, format } = useText();
  const model = useSupertonicModel();
  const voice = useVoiceSettings((state) => state.supertonicVoice);
  const size = format.fileSize(SUPERTONIC_MODEL_BYTES);
  const status =
    model.phase === "downloading"
      ? t("mobile.settings.voice.supertonic.downloading", { percent: format.percent(model.progress) })
      : model.phase === "ready"
        ? t("mobile.settings.voice.supertonic.ready", { size })
        : model.phase === "error"
          ? t(
              model.failure === "verify"
                ? "mobile.settings.voice.supertonic.verifyFailed"
                : "mobile.settings.voice.supertonic.downloadFailed",
            )
          : t("mobile.settings.voice.supertonic.missing", { size });
  const remove = () =>
    Alert.alert(t("mobile.settings.voice.supertonic.removeTitle"), t("mobile.settings.voice.supertonic.removeBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("mobile.settings.voice.supertonic.remove"),
        style: "destructive",
        onPress: () => {
          preview.stop();
          void removeSupertonicModel().catch(() => onError(currentText().t("mobile.settings.voice.removeFailed")));
        },
      },
    ]);
  const action =
    model.phase === "downloading" ? (
      <Button size="sm" variant="secondary" onPress={cancelSupertonicDownload}>
        <Button.Label>{t("common.cancel")}</Button.Label>
      </Button>
    ) : model.phase === "ready" ? (
      <Button size="sm" variant="secondary" onPress={remove}>
        <Button.Label className="text-danger-text">{t("mobile.settings.voice.supertonic.remove")}</Button.Label>
      </Button>
    ) : (
      <Button
        size="sm"
        variant="secondary"
        isDisabled={model.phase === "unknown"}
        onPress={() => void downloadSupertonicModel()}
      >
        <Button.Label>{t("mobile.settings.voice.supertonic.download")}</Button.Label>
      </Button>
    );
  return (
    <SettingsSection
      title={t("mobile.settings.voice.supertonic.title")}
      footer={t("mobile.settings.voice.supertonic.footer")}
    >
      <SettingsRow supportingText={status} trailing={action}>
        <Typography.Paragraph>{t("mobile.settings.voice.supertonic.model")}</Typography.Paragraph>
      </SettingsRow>
      <SettingsRow
        supportingText={supertonicVoiceLabel(voice, t)}
        onPress={() => router.push({ pathname: "/settings/voice-choice", params: { engine: "supertonic" } })}
      >
        <Typography.Paragraph>{t("mobile.settings.voice.voice")}</Typography.Paragraph>
      </SettingsRow>
      <ListenRow
        enabled={model.phase === "ready"}
        playing={preview.playing === "settings"}
        onPress={() => preview.toggle("settings", { engine: "supertonic", supertonicVoice: voice })}
      />
    </SettingsSection>
  );
}

function ElevenLabsSection({
  preview,
  onError,
}: {
  preview: ReturnType<typeof useVoicePreview>;
  onError: (message: string) => void;
}) {
  const { t } = useText();
  const voice = useVoiceSettings((state) => state.elevenLabsVoice);
  const remove = () =>
    Alert.alert(t("mobile.settings.voice.elevenLabs.removeTitle"), t("mobile.settings.voice.elevenLabs.removeBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("mobile.settings.voice.elevenLabs.removeKey"),
        style: "destructive",
        onPress: () => {
          preview.stop();
          clearElevenLabsVoices();
          void removeElevenLabsKey().catch(() => onError(currentText().t("mobile.settings.voice.removeFailed")));
        },
      },
    ]);
  return (
    <SettingsSection
      title={t("mobile.settings.voice.elevenLabs.title")}
      footer={t("mobile.settings.voice.elevenLabs.footer")}
    >
      <SettingsRow
        supportingText={t("mobile.settings.voice.elevenLabs.keySaved")}
        onPress={() => router.push("/settings/elevenlabs-key")}
      >
        <Typography.Paragraph>{t("mobile.settings.voice.elevenLabs.key")}</Typography.Paragraph>
      </SettingsRow>
      <SettingsRow
        supportingText={
          voice ? elevenLabsVoiceParts(voice.name).title : t("mobile.settings.voice.elevenLabs.chooseVoice")
        }
        onPress={() => router.push({ pathname: "/settings/voice-choice", params: { engine: "elevenlabs" } })}
      >
        <Typography.Paragraph>{t("mobile.settings.voice.voice")}</Typography.Paragraph>
      </SettingsRow>
      <ListenRow
        enabled={voice !== null}
        playing={preview.playing === "settings"}
        onPress={() => {
          if (voice) preview.toggle("settings", { engine: "elevenlabs", elevenLabsVoice: voice });
        }}
      />
      <SettingsRow disclosure={false} onPress={remove}>
        <Typography.Paragraph className="text-danger-text">
          {t("mobile.settings.voice.elevenLabs.removeKey")}
        </Typography.Paragraph>
      </SettingsRow>
    </SettingsSection>
  );
}

/**
 * Settings > Voice: the voice that reads replies in a voice conversation. The first section says which
 * voice is in use, and the section below it has the settings of that voice only: Supertonic 3, the
 * default, which runs on the phone as on desktop, or ElevenLabs with the user's own key.
 */
export function VoiceSettingsScreen() {
  const { t } = useText();
  const preview = useVoicePreview();
  const engine = useVoiceSettings((state) => state.engine);
  const hasKey = useVoiceSettings((state) => state.hasElevenLabsKey);
  const [error, setError] = useState<string | null>(null);
  const showError = useRef((message: string) => {
    setError(message);
    void haptics.notification("error");
  }).current;
  // The voices of the key load once, so the voice list opens with them.
  useEffect(() => {
    if (hasKey && useElevenLabsVoices.getState().phase === "idle") void loadElevenLabsVoices();
  }, [hasKey]);
  // A sample of the voice before it does not go on under the settings of the other one.
  const stopPreview = useRef(preview.stop);
  stopPreview.current = preview.stop;
  const shownEngine = useRef(engine);
  useEffect(() => {
    if (shownEngine.current === engine) return;
    shownEngine.current = engine;
    stopPreview.current();
  }, [engine]);
  if (!speechNative)
    return (
      <SettingsContent>
        <SettingsNote>{t("mobile.settings.voice.unavailable")}</SettingsNote>
      </SettingsContent>
    );
  return (
    <SettingsContent>
      <EngineSection onError={showError} />
      {engine === "elevenlabs" && hasKey ? (
        <ElevenLabsSection preview={preview} onError={showError} />
      ) : (
        <SupertonicSection preview={preview} onError={showError} />
      )}
      {error || preview.error ? (
        <Typography.Paragraph accessibilityRole="alert" type="body-xs" className="px-4 text-danger-text">
          {error ?? preview.error}
        </Typography.Paragraph>
      ) : null}
      <SettingsSection>
        <SettingsRow onPress={() => router.push("/settings/language")}>
          <Typography.Paragraph>{t("mobile.settings.dictation.language")}</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
    </SettingsContent>
  );
}
