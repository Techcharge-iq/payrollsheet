import { Minus, Plus } from "lucide-react";
import { input } from "./ui";

function shiftTime(value: string, minutes: number) {
  const [hours, mins] = value.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(mins)) return value;
  const total = (hours * 60 + mins + minutes + 24 * 60) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  label: string;
  disabled?: boolean;
  compact?: boolean;
}

export function TimeControl({ value, onChange, label, disabled = false, compact = false }: Props) {
  return (
    <div className={`flex items-center ${compact ? "gap-0.5" : "gap-1"}`}>
      <button
        type="button"
        onClick={() => onChange(shiftTime(value || "08:00", -15))}
        disabled={disabled}
        aria-label={`${label} 15 minutes earlier`}
        title="15 minutes earlier"
        className={`${compact ? "h-9 w-9" : "h-11 w-11"} inline-flex shrink-0 items-center justify-center rounded-md border border-border bg-card text-slate-600 hover:border-gold hover:bg-gold/10 disabled:opacity-40`}
      >
        <Minus size={14} />
      </button>
      <input
        type="time"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        aria-label={label}
        className={`${input} ${compact ? "h-10 min-w-32 px-2 py-1" : "h-11 min-w-32 px-3 py-2"} text-center font-bold tabular-nums disabled:opacity-50`}
      />
      <button
        type="button"
        onClick={() => onChange(shiftTime(value || "08:00", 15))}
        disabled={disabled}
        aria-label={`${label} 15 minutes later`}
        title="15 minutes later"
        className={`${compact ? "h-9 w-9" : "h-11 w-11"} inline-flex shrink-0 items-center justify-center rounded-md border border-border bg-card text-slate-600 hover:border-gold hover:bg-gold/10 disabled:opacity-40`}
      >
        <Plus size={14} />
      </button>
    </div>
  );
}
