import { useEffect, useState, type RefObject } from "react";
import { captureFrame } from "../optics/viewfinder";
import { sensorAspect, type OutputResolution } from "../optics/projection";
import type { Framing } from "../optics/framing";

/**
 * Framing guides drawn over the viewfinder.
 *
 * The guide rectangle is the part of the canvas the planned camera would
 * actually record: the preview is deliberately not stretched to the window,
 * so everything outside the guide is scene the camera would miss.
 *
 * Entirely `pointer-events: none`, so Cesium keeps every drag, wheel and
 * pinch it would otherwise receive.
 */

interface Props {
  resolution: OutputResolution;
  bearingDeg: number;
  tiltDeg: number;
  horizontalFovDeg: number;
  verticalFovDeg: number;
  /** Absent when no target is placed. */
  framing: Framing | null;
  /** Cesium globe container; the canvas inside it is the true viewport. */
  viewportRef?: RefObject<HTMLElement | null>;
}

export default function ViewfinderOverlay(props: Props) {
  const aspect = useViewportAspect(props.viewportRef);
  const frame = captureFrame(aspect, sensorAspect(props.resolution));

  const inFrame = props.framing?.image.inFrame === true;
  // Guide-relative, since the guide is what carries the camera's own field of
  // view; placing it against the whole canvas would drift as the window
  // changes shape.
  const marker = inFrame
    ? {
        left: `${50 + (props.framing!.image.x * frame.widthFraction * 100) / 2}%`,
        top: `${50 - (props.framing!.image.y * frame.heightFraction * 100) / 2}%`,
      }
    : null;

  return (
    <div className="viewfinder" aria-hidden="true">
      <div
        className="viewfinder-frame"
        style={{
          width: `${frame.widthFraction * 100}%`,
          height: `${frame.heightFraction * 100}%`,
        }}
      >
        <span className="viewfinder-frame-label">RECORDED FRAME</span>
        <span className="viewfinder-corner tl" />
        <span className="viewfinder-corner tr" />
        <span className="viewfinder-corner br" />
        <span className="viewfinder-corner bl" />
        <span className="viewfinder-crosshair" />
      </div>

      {marker && <span className="viewfinder-target" style={marker} />}

      <div className="viewfinder-readout">
        <span>{props.resolution.label}</span>
        <span>
          {props.horizontalFovDeg.toFixed(0)}° × {props.verticalFovDeg.toFixed(0)}°
        </span>
        <span>
          {props.bearingDeg.toFixed(0)}° · {props.tiltDeg.toFixed(0)}° down
        </span>
      </div>
    </div>
  );
}

/** Tracks the Cesium canvas shape, falling back to the window only if needed. */
function useViewportAspect(viewportRef?: RefObject<HTMLElement | null>): number {
  const [aspect, setAspect] = useState(() => measureAspect(viewportRef?.current));

  useEffect(() => {
    const root = viewportRef?.current ?? null;
    const update = () => setAspect(measureAspect(root));
    update();

    const target = viewportElement(root);
    if (target && typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(update);
      observer.observe(target);
      if (root && root !== target) observer.observe(root);
      return () => observer.disconnect();
    }

    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [viewportRef]);

  return aspect;
}

function viewportElement(root: HTMLElement | null | undefined): Element | null {
  return root?.querySelector("canvas") ?? root ?? null;
}

export function measureAspect(root: HTMLElement | null | undefined): number {
  const target = viewportElement(root) as HTMLElement | null;
  if (target && target.clientHeight > 0 && target.clientWidth > 0) {
    return target.clientWidth / target.clientHeight;
  }
  if (typeof window === "undefined" || window.innerHeight === 0) return 16 / 9;
  return window.innerWidth / window.innerHeight;
}
