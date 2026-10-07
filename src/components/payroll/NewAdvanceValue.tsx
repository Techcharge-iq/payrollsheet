import { fmt, toNum } from "@/lib/payroll";

export function NewAdvanceValue({ value }: { value: number | string }) {
  const amount = toNum(value);
  return amount > 0 ? (
    <strong className="inline-flex rounded-md bg-gold/15 px-2 py-1 font-extrabold text-warn">
      {fmt(amount)}
    </strong>
  ) : (
    <span className="text-muted-foreground">{fmt(amount)}</span>
  );
}