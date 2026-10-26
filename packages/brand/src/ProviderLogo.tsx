import type { JSX } from "@solidjs/web";
import { modelBrandMark, modelBrandMarkShape } from "./model-brand-mark";
import { type ProviderLogoShape, type ProviderLogoVariant, providerLogoShape } from "./provider-logo-shape";

export type { ProviderLogoVariant } from "./provider-logo-shape";

export interface ProviderLogoProps {
  provider: ProviderLogoVariant;
  class?: JSX.SvgSVGAttributes<SVGSVGElement>["class"];
}

function LogoShape(props: {
  shape: ProviderLogoShape;
  provider: ProviderLogoVariant;
  mark?: string | undefined;
  class?: JSX.SvgSVGAttributes<SVGSVGElement>["class"];
}) {
  return (
    <svg
      class={props.class}
      viewBox={props.shape.viewBox}
      aria-hidden="true"
      data-provider={props.provider}
      data-model-mark={props.mark}
    >
      {props.shape.paths.map((path) => (
        <path d={path.d} opacity={path.opacity} fill-rule={path.evenOdd ? "evenodd" : undefined} />
      ))}
    </svg>
  );
}

export function ProviderLogo(props: ProviderLogoProps) {
  return <LogoShape shape={providerLogoShape(props.provider)} provider={props.provider} class={props.class} />;
}

export interface ModelLogoProps extends ProviderLogoProps {
  /** The model id, such as `zcode/GLM-5.2`. */
  model?: string | null | undefined;
  /** The name that the provider gives the model, such as `Hy3`. */
  modelName?: string | null | undefined;
}

/**
 * The logo of a model. A Magpie model shows the mark of its maker, because Magpie routes to many
 * makers. A model of any other provider shows the provider mark, as `ProviderLogo` does.
 */
export function ModelLogo(props: ModelLogoProps) {
  const mark = () => (props.provider === "magpie" && props.model ? modelBrandMark(props.model, props.modelName) : null);
  const shape = () => {
    const value = mark();
    return value ? modelBrandMarkShape(value) : providerLogoShape(props.provider);
  };
  return <LogoShape shape={shape()} provider={props.provider} mark={mark() ?? undefined} class={props.class} />;
}
