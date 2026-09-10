import { Badge } from "@/components/ui/badge"

const statusConfig = {
  WAITING: {
    label: "Menunggu",
    variant: "muted" as const,
  },
  IN_PROGRESS: {
    label: "Diproses",
    variant: "info" as const,
  },
  ESCALATED: {
    label: "Eskalasi",
    variant: "warning" as const,
  },
  DONE: {
    label: "Selesai",
    variant: "success" as const,
  },
}

export default function OrderStatusBadge({
  status,
}: {
  status: keyof typeof statusConfig
}) {
  const config = statusConfig[status]

  return (
    <Badge variant={config.variant}>{config.label}</Badge>
  )
}
