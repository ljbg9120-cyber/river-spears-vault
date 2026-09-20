/**
 * Grouped typeface picker.
 *
 * Every option is previewed in its own typeface, which means loading it. With
 * forty-odd on offer, fetching them all to render a list would be worse than
 * the feature is worth — so each one loads only when it actually scrolls into
 * view.
 */
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { fontStack, glowStyle, loadFont } from "../lib/fonts";
import { Spinner } from "./ui";

export default function FontPicker({
  value,
  onPick,
  glow = 0,
  accent = "rgb(var(--accent-rgb))",
  sample = "Aa",
}: {
  value: string;
  onPick: (font: string) => void;
  glow?: number;
  accent?: string;
  /** Text shown in each preview. */
  sample?: string;
}) {
  const [groups, setGroups] = useState<Record<string, string[]> | null>(null);

  useEffect(() => {
    api.get<Record<string, string[]>>("/api/fonts/groups")
      .then(setGroups)
      .catch(() => setGroups({}));
  }, []);

  useEffect(() => { loadFont(value); }, [value]);

  if (!groups) {
    return <div className="flex justify-center py-6 text-muted"><Spinner size={20} /></div>;
  }

  return (
    <div className="max-h-[320px] space-y-4 overflow-y-auto pr-1">
      {Object.entries(groups).map(([group, fonts]) => (
        <div key={group}>
          <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted">
            {group}
          </p>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {fonts.map((font) => (
              <FontOption
                key={font}
                font={font}
                sample={sample}
                active={value === font}
                glow={glow}
                accent={accent}
                onPick={onPick}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function FontOption({
  font, sample, active, glow, accent, onPick,
}: {
  font: string;
  sample: string;
  active: boolean;
  glow: number;
  accent: string;
  onPick: (font: string) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || visible) return;
    if (typeof IntersectionObserver === "undefined") { setVisible(true); return; }

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setVisible(true);
        loadFont(font);
        observer.disconnect();
      }
    }, { rootMargin: "120px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, [font, visible]);

  return (
    <button
      ref={ref}
      onClick={() => onPick(font)}
      onMouseEnter={() => loadFont(font)}
      className="card px-2.5 py-2 text-left transition"
      style={{
        borderColor: active ? "rgb(var(--accent-rgb))" : undefined,
        background: active ? "rgb(var(--accent-rgb) / 0.12)" : undefined,
      }}
    >
      <span
        className="block truncate text-xl font-bold leading-tight"
        style={{
          // Until it has loaded, the fallback renders — which is fine, and
          // better than an empty box or a layout jump.
          fontFamily: visible ? fontStack(font) : undefined,
          color: glow ? accent : undefined,
          textShadow: glowStyle(glow, accent),
        }}
      >
        {sample}
      </span>
      <span className="mt-0.5 block truncate text-[10px] text-muted">{font}</span>
    </button>
  );
}
