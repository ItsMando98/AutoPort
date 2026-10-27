import { cn } from "@/src/lib/utils"

function EmptyState({ label, className }: { label: string; className?: string }) {
  return (
    <div className={cn("rounded-xl border border-dashed border-zinc-800 bg-zinc-950/40 px-4 py-8 text-center text-sm text-zinc-500", className)}>
      {label}
    </div>
  )
}

function EmptyRow({ label, className }: { label: string; className?: string }) {
  return <div className={cn("px-4 py-8 text-sm text-zinc-500", className)}>{label}</div>
}

export { EmptyState, EmptyRow }
