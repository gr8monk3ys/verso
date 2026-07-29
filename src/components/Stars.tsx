"use client";

import { useState } from "react";

/**
 * One star, filled 0 / 50 / 100%. Drawn as a gold star clipped over a dim one
 * rather than with a half-star glyph, which is missing from enough fonts to
 * show as a box on exactly the phones this is used on.
 */
function Star({ fill, className = "" }: { fill: 0 | 0.5 | 1; className?: string }) {
  return (
    <span className={`relative inline-block leading-none ${className}`} aria-hidden>
      <span className="text-[var(--color-line)]">★</span>
      {fill > 0 && (
        <span
          className="absolute inset-0 overflow-hidden text-[var(--color-accent)]"
          style={{ width: fill === 1 ? "100%" : "50%" }}
        >
          ★
        </span>
      )}
    </span>
  );
}

function fillFor(shown: number | null, index: number): 0 | 0.5 | 1 {
  if (shown == null) return 0;
  const remaining = shown - index * 2;
  if (remaining >= 2) return 1;
  if (remaining >= 1) return 0.5;
  return 0;
}

/** Read-only rating display. `value` is in half-star units (1..10). */
export function Stars({
  value,
  size = "sm",
  className = "",
}: {
  value: number | null | undefined;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  if (value == null) return null;
  const sizes = { sm: "text-[13px]", md: "text-base", lg: "text-2xl" };
  return (
    <span
      className={`${sizes[size]} tracking-[0.06em] ${className}`}
      title={`${value / 2} out of 5`}
      aria-label={`${value / 2} out of 5`}
    >
      {Array.from({ length: 5 }, (_, index) => (
        <Star key={index} fill={fillFor(value, index)} />
      ))}
    </span>
  );
}

/**
 * Half-star input.
 *
 * Tap targets are deliberately large: this is used one-handed, standing up,
 * often while walking. Tapping the current value again clears it — leaving a
 * sighting unrated has to stay as easy as rating it (§9.1).
 */
export function StarInput({
  name,
  defaultValue = null,
  onChange,
  size = "lg",
}: {
  name?: string;
  defaultValue?: number | null;
  onChange?: (value: number | null) => void;
  size?: "md" | "lg";
}) {
  const [value, setValue] = useState<number | null>(defaultValue);
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? value;

  function set(next: number) {
    const resolved = value === next ? null : next;
    setValue(resolved);
    onChange?.(resolved);
  }

  return (
    <div className="flex items-center gap-3">
      {name && <input type="hidden" name={name} value={value ?? ""} />}
      <div
        className="flex items-center"
        onMouseLeave={() => setHover(null)}
        role="radiogroup"
        aria-label="Rating"
      >
        {Array.from({ length: 5 }, (_, index) => (
          <span key={index} className="relative inline-flex">
            <Star fill={fillFor(shown, index)} className={size === "lg" ? "text-4xl" : "text-2xl"} />
            <button
              type="button"
              aria-label={`${index + 0.5} stars`}
              className="absolute inset-y-0 left-0 w-1/2 cursor-pointer"
              onMouseEnter={() => setHover(index * 2 + 1)}
              onClick={() => set(index * 2 + 1)}
            />
            <button
              type="button"
              aria-label={`${index + 1} stars`}
              className="absolute inset-y-0 right-0 w-1/2 cursor-pointer"
              onMouseEnter={() => setHover(index * 2 + 2)}
              onClick={() => set(index * 2 + 2)}
            />
          </span>
        ))}
      </div>
      <span className="text-sm text-[var(--color-muted)] tabular-nums">
        {value == null ? "unrated" : `${value / 2} / 5`}
      </span>
    </div>
  );
}
