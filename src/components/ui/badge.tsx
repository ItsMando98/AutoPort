import * as React from "react"
import { cn } from "@/src/lib/utils"

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "secondary" | "destructive" | "outline" | "success" | "warning"
  className?: string
  children?: React.ReactNode
  key?: React.Key
}

function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-zinc-300 focus:ring-offset-2",
        {
          "border-transparent bg-zinc-50 text-zinc-900 hover:bg-zinc-50/80": variant === "default",
          "border-transparent bg-zinc-800 text-zinc-50 hover:bg-zinc-800/80": variant === "secondary",
          "border-transparent bg-red-900 text-red-50 hover:bg-red-900/80": variant === "destructive",
          "border-transparent bg-emerald-900/50 text-emerald-400 hover:bg-emerald-900/80": variant === "success",
          "border-transparent bg-amber-900/50 text-amber-400 hover:bg-amber-900/80": variant === "warning",
          "text-zinc-50 border-zinc-800": variant === "outline",
        },
        className
      )}
      {...props}
    />
  )
}

export { Badge }
