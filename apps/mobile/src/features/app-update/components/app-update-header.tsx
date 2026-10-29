import { StatusBar } from "expo-status-bar";
import { Button, Typography } from "heroui-native";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import Animated, {
  Extrapolation,
  interpolate,
  type SharedValue,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";

import { showFailureAlert } from "@/features/analytics/failure-reports";
import { type AppUpdate, dismissAppUpdate, installAppUpdate } from "@/features/app-update/model/app-update";
import { BloubEyes, EYES_HEIGHT, EYES_WIDTH } from "@/shared/components/bloub-stage/bloub-eyes";
import { BLOUB_MOVE, BLOUB_RADIUS, bloubGradient, useBloubColors } from "@/shared/components/bloub-stage/bloub-look";
import type { BloubMood } from "@/shared/components/bloub-stage/bloub-stage-store";
import type { LargeTitleScroll } from "@/shared/components/large-title";
import { haptics } from "@/shared/lib/haptics";
import { useReducedMotion } from "@/shared/lib/motion";
import { currentText, useText } from "@/shared/lib/text";

// The eyes sit under the status bar, between the bar buttons, and the text sits under them.
const EYES_SCALE = 0.55;
const EYES_TOP = 6;
const CAPTION_GAP = 10;
const BOTTOM_PADDING = 26;
/** The space between the edge of the block and the big title under it. */
const TITLE_GAP = 12;
// The block drops after the list has come in. Later lets the eyes look down before it rolls up.
const DROP_DELAY_MS = 400;
const LATER_DELAY_MS = 140;
const HAPPY_MS = 1400;
const LATER_FILL = "rgba(4, 0, 7, 0.09)";

export interface AppUpdateHeader {
  /** The update on the block. It stays while the block rolls up. */
  shown: AppUpdate | null;
  /** Where the lower edge of the block rests, before the list scrolls it. 0 until the text is measured. */
  drop: SharedValue<number>;
  rest: number;
  /**
   * True while the edge moves. The list header changes height on every frame then, so a layout
   * transition in it, such as the pinned grid's, must not run.
   */
  moving: boolean;
  measure: (height: number) => void;
}

/**
 * The state of the update header on home: the lilac block of the splash and the sign-in header,
 * which drops to a short header when an update comes and rolls up again when it goes.
 */
export function useAppUpdateHeader(update: AppUpdate | null): AppUpdateHeader {
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const [shown, setShown] = useState<AppUpdate | null>(update);
  const [captionHeight, setCaptionHeight] = useState(0);
  const [moving, setMoving] = useState(false);
  const drop = useSharedValue(0);
  const latest = useRef(update);
  latest.current = update;
  const updateId = update?.id ?? null;
  const rest =
    captionHeight > 0
      ? insets.top + EYES_TOP + EYES_HEIGHT * EYES_SCALE + CAPTION_GAP + captionHeight + BOTTOM_PADDING
      : 0;

  useEffect(() => {
    if (updateId) setShown(latest.current);
  }, [updateId]);
  const showing = shown !== null && updateId !== null;
  useEffect(() => {
    if (showing) {
      if (rest === 0) return;
      // The first drop waits for the list; a later change of the text height moves the edge at once.
      const first = drop.get() === 0;
      if (reduced) {
        drop.set(rest);
        return;
      }
      setMoving(true);
      drop.set(
        withDelay(
          first ? DROP_DELAY_MS : 0,
          withTiming(rest, BLOUB_MOVE, (finished) => {
            if (finished) scheduleOnRN(setMoving, false);
          }),
        ),
      );
      return;
    }
    if (!shown) return;
    const clear = () => {
      setMoving(false);
      setShown(null);
    };
    if (reduced) {
      drop.set(0);
      clear();
      return;
    }
    setMoving(true);
    drop.set(
      withDelay(
        LATER_DELAY_MS,
        withTiming(0, BLOUB_MOVE, (finished) => {
          if (finished) scheduleOnRN(clear);
        }),
      ),
    );
  }, [drop, reduced, rest, shown, showing]);

  return { shown, drop, rest, moving, measure: setCaptionHeight };
}

/**
 * The room for the block above the big title. It is part of the title, so the title fades under the
 * bar at the right scroll position. The block's edge rests a little above the title.
 */
export function AppUpdateSpacer({ header, headerHeight }: { header: AppUpdateHeader; headerHeight: number }) {
  const { drop, rest } = header;
  const room = Math.max(0, rest - headerHeight + TITLE_GAP);
  const style = useAnimatedStyle(() => ({
    height: rest > 0 ? interpolate(drop.get(), [0, rest], [0, room], Extrapolation.CLAMP) : 0,
  }));
  if (!header.shown) return null;
  return <Animated.View style={style} />;
}

/**
 * The lilac block with the eyes, the text and the two actions. It draws above the scroll edge effect
 * and under the native bar buttons. The list scrolls it away, and a pull past the top stretches it.
 * Touches on the block go to the list below; only the buttons take them.
 */
export function AppUpdateBlock({
  header,
  scroll,
  hidden,
}: {
  header: AppUpdateHeader;
  scroll: LargeTitleScroll;
  /** Hides the block while home search shows. */
  hidden: boolean;
}) {
  const { t } = useText();
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const colors = useBloubColors();
  const gazeX = useSharedValue(0);
  const gazeY = useSharedValue(0);
  const [mood, setMood] = useState<BloubMood>("idle");
  const [underStatusBar, setUnderStatusBar] = useState(false);
  const { shown, drop, rest, measure } = header;
  const { scrolled, headerHeight } = scroll;
  const span = window.height + BLOUB_RADIUS;
  const statusBottom = insets.top;
  const leaving = shown !== null && mood === "down";

  useEffect(() => {
    if (mood !== "happy") return;
    const timer = setTimeout(() => setMood("idle"), HAPPY_MS);
    return () => clearTimeout(timer);
  }, [mood]);
  // Another update starts with eyes that look ahead.
  const shownId = shown?.id;
  useEffect(() => {
    if (shownId) setMood("idle");
  }, [shownId]);

  useAnimatedReaction(
    () => drop.get() - scrolled.get() > statusBottom,
    (next, previous) => {
      if (next !== previous) scheduleOnRN(setUnderStatusBar, next);
    },
  );
  const blockStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: Math.max(0, drop.get() - scrolled.get()) - span }],
  }));
  // The light stays still on the screen while the edge moves over it.
  const glowStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: span - Math.max(0, drop.get() - scrolled.get()) }],
  }));
  // The eyes and the text move with the edge, and fade as they go under the bar.
  const contentStyle = useAnimatedStyle(() => {
    const edge = Math.max(0, drop.get() - scrolled.get());
    return {
      opacity: rest > 0 ? interpolate(edge, [headerHeight + 24, rest], [0, 1], Extrapolation.CLAMP) : 0,
      transform: [{ translateY: rest > 0 ? edge - rest : 0 }],
    };
  });

  if (!shown) return null;
  const update = shown;
  const ready = update.kind === "ready";
  const install = () => {
    void haptics.impact("light");
    setMood("happy");
    // The reload screen has the color of the splash, so the restart reads as the app opening.
    installAppUpdate(update, colors.dark ? colors.dimBody : colors.body).catch((error: unknown) => {
      const { t: text } = currentText();
      showFailureAlert(
        error,
        "update",
        text("mobile.app.update.failedTitle"),
        text(ready ? "mobile.app.update.restartFailed" : "mobile.app.update.storeFailed"),
      );
    });
  };
  const later = () => {
    void haptics.impact("soft");
    setMood("down");
    void dismissAppUpdate(update).catch(() => undefined);
  };
  const eyesTop = statusBottom + EYES_TOP + (EYES_HEIGHT * EYES_SCALE - EYES_HEIGHT) / 2;
  const captionTop = statusBottom + EYES_TOP + EYES_HEIGHT * EYES_SCALE + CAPTION_GAP;

  return (
    <Animated.View
      pointerEvents={hidden || leaving ? "none" : "box-none"}
      style={[
        StyleSheet.absoluteFill,
        { opacity: hidden ? 0 : 1, transitionProperty: "opacity", transitionDuration: reduced ? 0 : 200 },
      ]}
    >
      {underStatusBar && !hidden ? <StatusBar style="dark" /> : null}
      <Animated.View pointerEvents="none" style={[styles.block, { height: span }, blockStyle]}>
        <View style={[styles.clip, { backgroundColor: colors.body }]}>
          <Animated.View
            style={[
              styles.glow,
              { height: window.height, experimental_backgroundImage: bloubGradient(colors.light, colors.body) },
              glowStyle,
            ]}
          />
        </View>
      </Animated.View>
      <Animated.View pointerEvents="box-none" style={[StyleSheet.absoluteFill, contentStyle]}>
        <View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[
            styles.eyes,
            {
              top: eyesTop,
              left: (window.width - EYES_WIDTH) / 2,
              transform: [{ scale: EYES_SCALE }],
            },
          ]}
        >
          <BloubEyes mood={mood} active={!hidden} reduced={reduced} gazeX={gazeX} gazeY={gazeY} eyeColor={colors.eye} />
        </View>
        <View
          pointerEvents="box-none"
          className="absolute inset-x-6 items-center"
          style={{ top: captionTop }}
          onLayout={(event) => measure(event.nativeEvent.layout.height)}
        >
          <Typography.Heading
            type="h4"
            align="center"
            accessibilityRole="header"
            className="tracking-openbot-tight"
            style={{ color: colors.eye }}
          >
            {ready ? t("mobile.app.update.readyTitle") : t("mobile.app.update.title", { version: update.version })}
          </Typography.Heading>
          <Typography.Paragraph type="body-sm" align="center" style={{ color: colors.eye, opacity: 0.62 }}>
            {t(ready ? "mobile.app.update.readyBody" : "mobile.app.update.storeBody")}
          </Typography.Paragraph>
          <View className="mt-3.5 flex-row gap-2">
            <Button
              size="sm"
              variant="ghost"
              feedbackVariant="scale"
              style={[styles.action, { backgroundColor: colors.eye }]}
              onPress={install}
            >
              <Button.Label className="font-sans font-semibold" style={{ color: colors.body }}>
                {t("mobile.app.update.install")}
              </Button.Label>
            </Button>
            <Button
              size="sm"
              variant="ghost"
              feedbackVariant="scale"
              style={[styles.action, { backgroundColor: LATER_FILL }]}
              onPress={later}
            >
              <Button.Label className="font-sans font-semibold" style={{ color: colors.eye }}>
                {t("mobile.app.update.later")}
              </Button.Label>
            </Button>
          </View>
        </View>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  block: { position: "absolute", left: 0, right: 0, top: 0 },
  clip: {
    flex: 1,
    overflow: "hidden",
    borderBottomLeftRadius: BLOUB_RADIUS,
    borderBottomRightRadius: BLOUB_RADIUS,
    borderCurve: "continuous",
  },
  glow: { position: "absolute", left: 0, right: 0, top: 0 },
  eyes: { position: "absolute", width: EYES_WIDTH, height: EYES_HEIGHT },
  action: { height: 40, borderRadius: 999, paddingHorizontal: 18 },
});
