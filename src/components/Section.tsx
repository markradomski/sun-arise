import { useState, type ReactNode } from "react";

interface Props {
  title: string;
  /** Short status shown on the header row, e.g. the active season. */
  badge?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}

export default function Section(props: Props) {
  const [open, setOpen] = useState(props.defaultOpen ?? true);

  return (
    <section className={`panel-section ${open ? "open" : "closed"}`}>
      <button className="panel-section-head" onClick={() => setOpen(!open)}>
        <span className="panel-section-title">{props.title}</span>
        {props.badge !== undefined && (
          <span className="panel-section-badge">{props.badge}</span>
        )}
        <span className="panel-section-chevron">{open ? "−" : "+"}</span>
      </button>
      {open && <div className="panel-section-body">{props.children}</div>}
    </section>
  );
}
