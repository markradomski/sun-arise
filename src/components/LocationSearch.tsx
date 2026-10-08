import { useId, useState } from "react";
import type { LatLng } from "../scene/geo";
import { classifyQuery, formatCoordinates } from "../scene/location";

/**
 * Shared location navigation.
 *
 * Going to a place and adopting it as the analysed site are deliberately two
 * separate actions. Navigating must never disturb an existing house placement
 * or its analysis, so replacing the active site takes its own explicit press.
 */

export interface ResolvedLocation {
  position: LatLng;
  label: string;
  /** The geocoder returned an area, so this is a centre rather than the address. */
  approximate: boolean;
  /** Terrain elevation at the position, once sampled. */
  elevationMeters: number | null;
  elevationStatus: "PENDING" | "READY" | "UNAVAILABLE";
}

interface Props {
  resolved: ResolvedLocation | null;
  busy: boolean;
  error: string | null;
  hasActiveSite: boolean;
  onSearch: (query: string) => void;
  onGoTo: () => void;
  onSetSite: () => void;
  onClear: () => void;
}

export default function LocationSearch(props: Props) {
  const [value, setValue] = useState("");
  const inputId = useId();
  const statusId = useId();

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (classifyQuery(value)) props.onSearch(value);
  };

  return (
    <form className="location" onSubmit={submit}>
      <label className="field-label" htmlFor={inputId}>
        Address or coordinates
      </label>
      <div className="location-row">
        <input
          id={inputId}
          type="text"
          value={value}
          placeholder="-41.0023, 147.0858"
          autoComplete="off"
          spellCheck={false}
          aria-describedby={statusId}
          onChange={(event) => setValue(event.target.value)}
        />
        <button type="submit" disabled={props.busy || !classifyQuery(value)}>
          {props.busy ? "Finding…" : "Find"}
        </button>
      </div>

      <div id={statusId} role="status" aria-live="polite">
        {props.error && <p className="note warn">{props.error}</p>}

        {props.resolved && !props.error && (
          <div className="location-result">
            <p className="location-name">{props.resolved.label}</p>
            <p className="location-coords">
              {formatCoordinates(props.resolved.position)}
            </p>
            <p className="location-elevation muted">
              {elevationText(props.resolved)}
            </p>
            {props.resolved.approximate && (
              <p className="note warn">
                This is the centre of an area the geocoder matched, not a
                verified street address. Check it on the map before relying on
                it.
              </p>
            )}
          </div>
        )}
      </div>

      {props.resolved && !props.error && (
        <div className="button-row">
          <button type="button" onClick={props.onGoTo}>
            Go to location
          </button>
          <button type="button" className="secondary" onClick={props.onSetSite}>
            {props.hasActiveSite ? "Replace active site" : "Set active site"}
          </button>
          <button type="button" className="link" onClick={props.onClear}>
            Clear
          </button>
        </div>
      )}
    </form>
  );
}

function elevationText(resolved: ResolvedLocation): string {
  switch (resolved.elevationStatus) {
    case "PENDING":
      return "Sampling terrain elevation…";
    case "READY":
      return resolved.elevationMeters === null
        ? "Terrain elevation unavailable here."
        : `Terrain ${resolved.elevationMeters.toFixed(1)} m (ellipsoidal)`;
    case "UNAVAILABLE":
      return "Terrain elevation unavailable here.";
  }
}
