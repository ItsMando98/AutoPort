import type { MouseEventHandler, ReactNode } from "react"
import { cn } from "@/src/lib/utils"

export interface PillProps {
  active?: boolean
  /** Overrides the active-state styling (defaults to a neutral zinc fill). */
  activeClassName?: string
  className?: string
  children?: ReactNode
  onClick?: MouseEventHandler<HTMLButtonElement>
  disabled?: boolean
  // React's JSX key isn't a real prop but isn't auto-stripped in this project's
  // TS setup (no @types/react on the module path), so list usages need it here.
  key?: string | number
}

function Pill({ active, activeClassName, className, children, ...props }: PillProps) {
  return (
    <button
      type="button"
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-medium transition",
        active
          ? activeClassName ?? "border-zinc-500 bg-zinc-700 text-zinc-50"
          : "border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200",
        className
      )}
      {...props}
    >
      {children}
    </button>
  )
}

export { Pill }
