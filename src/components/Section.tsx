import { useEffect, useRef, useState, type ReactNode } from "react";

interface Props {
  title: string;
  /** Short status shown on the header row, e.g. the active season. */
  badge?: ReactNode;
  defaultOpen?: boolean;
  info?: ReactNode;
  children: ReactNode;
}

export default function Section(props: Props) {
  const [open, setOpen] = useState(props.defaultOpen ?? true);
  const [infoOpen, setInfoOpen] = useState(false);
  const infoRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!infoOpen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setInfoOpen(false); };
    const onClick = (event: MouseEvent) => { if (infoRef.current && !infoRef.current.contains(event.target as Node)) setInfoOpen(false); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onClick);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("pointerdown", onClick); };
  }, [infoOpen]);

  return (
    <section className={`panel-section ${open ? "open" : "closed"}`}>
      <div className="panel-section-header"><button className="panel-section-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="panel-section-title">{props.title}</span>
        {props.badge !== undefined && (
          <span className="panel-section-badge">{props.badge}</span>
        )}
        <span className="panel-section-chevron">{open ? "−" : "+"}</span>
      </button>{props.info && <div className="section-info-anchor" ref={infoRef}><button type="button" className="section-info-button" aria-label={`About ${props.title}`} aria-expanded={infoOpen} onClick={() => setInfoOpen((value) => !value)}>i</button>{infoOpen && <div className="section-info-popover" role="region" aria-label={`About ${props.title}`}><button type="button" className="section-info-close" aria-label="Close information" onClick={() => setInfoOpen(false)}>×</button>{props.info}</div>}</div>}</div>
      {open && <div className="panel-section-body">{props.children}</div>}
    </section>
  );
}
