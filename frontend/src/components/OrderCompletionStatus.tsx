import { Check, CircleAlert, LoaderCircle } from "lucide-react"
import type { CompletionEntry } from "@/contexts/OrderCompletionContext"

export default function OrderCompletionStatus({ entry }: { entry: CompletionEntry }) {
  if (entry.state === "saving") {
    return (
      <span role="status" className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm font-medium text-primary">
        <LoaderCircle className="size-4 motion-safe:animate-spin" aria-hidden="true" />
        Menyimpan…
      </span>
    )
  }

  if (entry.state === "failed") {
    return (
      <div role="alert" className="max-w-52 space-y-1">
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm font-medium text-destructive">
          <CircleAlert className="size-4" aria-hidden="true" />
          Gagal disimpan
        </span>
        {entry.error && <p className="text-xs text-muted-foreground">{entry.error}</p>}
      </div>
    )
  }

  if (entry.state === "completed") {
    return (
      <div role="status" className="space-y-1">
        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-300">
          <Check className="size-4" aria-hidden="true" />
          Selesai
        </span>
        {entry.delivery && (
          <p className={entry.warning ? "text-xs text-amber-800 dark:text-amber-300" : "text-xs text-muted-foreground"}>
            {entry.delivery}
          </p>
        )}
      </div>
    )
  }
}
