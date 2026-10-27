import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/src/components/ui/select"

// Radix Select forbids an empty-string item value (reserved to mean "cleared"),
// but several filter rows across the app use "" to represent "All ...". Map it
// to a sentinel internally so callers can keep passing "" as before.
const EMPTY_VALUE_SENTINEL = "__all__"

export function FilterSelect({
  value,
  onChange,
  options,
  className,
}: {
  value: string
  onChange: (value: string) => void
  options: Array<[string, string]>
  className?: string
}) {
  return (
    <Select
      value={value === "" ? EMPTY_VALUE_SENTINEL : value}
      onValueChange={(next) => onChange(next === EMPTY_VALUE_SENTINEL ? "" : next)}
    >
      <SelectTrigger className={className ?? "h-9 text-sm text-zinc-200"}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(([optionValue, label]) => (
          <SelectItem key={`${optionValue}-${label}`} value={optionValue === "" ? EMPTY_VALUE_SENTINEL : optionValue}>{label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
