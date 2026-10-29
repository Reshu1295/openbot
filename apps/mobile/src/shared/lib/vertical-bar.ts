import { useVerticalBarEdgeIOS } from "expo-status-bar";
import { isIOS } from "@/shared/lib/platform";

/**
 * Whether iOS shows the vertical bar beside the content, as on iPhone Duo. The bar holds the status
 * bar and the native bar buttons of the screen; custom views stay in the top bar. It reports the
 * bar, not the device: an open iPhone Duo in portrait has none.
 */
export function useVerticalBarShown(): boolean {
  const edge = useVerticalBarEdgeIOS();
  return isIOS && edge !== null;
}
