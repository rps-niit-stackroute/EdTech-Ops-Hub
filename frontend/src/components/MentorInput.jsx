import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";

/** Filters the known mentor list against the current text (case-insensitive, excludes an exact match). */
export function mentorSuggestions(query, mentors = [], limit = 6) {
  const q = (query || "").trim().toLowerCase();
  if (!q) return [];
  return mentors
    .filter((m) => m.toLowerCase().includes(q) && m.toLowerCase() !== q)
    .slice(0, limit);
}

/**
 * A plain text input that still accepts any free-typed name (new mentors are fine),
 * but suggests existing mentors as you type so a typo doesn't silently create a
 * phantom mentor that clash-detection and SOW billing then treat as a different person.
 */
export default function MentorInput({ value, onChange, mentors = [], className = "", placeholder = "Mentor", disabled, testid }) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef(null);
  const suggestions = mentorSuggestions(value, mentors);

  useEffect(() => {
    const onClickOutside = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const pick = (name) => {
    onChange(name);
    setOpen(false);
  };

  return (
    <div ref={wrapRef} className="relative">
      <Input
        className={className}
        placeholder={placeholder}
        value={value || ""}
        disabled={disabled}
        data-testid={testid}
        autoComplete="off"
        onChange={(e) => { onChange(e.target.value); setOpen(true); setHighlight(0); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (!open || suggestions.length === 0) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setHighlight((h) => Math.min(h + 1, suggestions.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); }
          else if (e.key === "Enter" && suggestions[highlight]) { e.preventDefault(); pick(suggestions[highlight]); }
          else if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && suggestions.length > 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-slate-200 bg-white py-1 shadow-md" data-testid={testid ? `${testid}-suggestions` : undefined}>
          {suggestions.map((m, i) => (
            <button
              type="button"
              key={m}
              onMouseDown={(e) => { e.preventDefault(); pick(m); }}
              className={`block w-full truncate px-2.5 py-1.5 text-left text-xs ${i === highlight ? "bg-slate-100" : "hover:bg-slate-50"}`}
            >
              {m}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
