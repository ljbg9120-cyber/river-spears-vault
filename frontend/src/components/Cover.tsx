/**
 * Album art wherever it appears. Falls back to the gradient-and-note tile when
 * there is no cover, so every surface looks deliberate either way.
 */
import { useState } from "react";
import { Icon } from "./ui";

export default function Cover({
  url,
  size,
  radius = 14,
  icon = 22,
  className = "",
  alt = "",
  thumb = false,
}: {
  url?: string;
  /** Pixel size for a fixed square; omit to fill the parent. */
  size?: number;
  radius?: number;
  icon?: number;
  className?: string;
  alt?: string;
  /** Ask for the 320px copy — anything small should, a 1000px JPEG is waste. */
  thumb?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  // The URL already carries a cache-busting version, so append rather than set.
  const src = url && thumb ? `${url}&thumb=1` : url;
  const show = src && !failed;

  const box: React.CSSProperties = size
    ? { width: size, height: size, borderRadius: radius }
    : { width: "100%", height: "100%", borderRadius: radius };

  return (
    <span
      className={`relative flex shrink-0 items-center justify-center overflow-hidden ${className}`}
      style={{
        ...box,
        background: show
          ? "rgb(var(--bg-rgb))"
          : "linear-gradient(135deg, rgb(var(--accent-rgb)), rgb(var(--accent2-rgb)))",
      }}
    >
      {show ? (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <span className="text-white/90">
          <Icon name="music" size={icon} />
        </span>
      )}
    </span>
  );
}
