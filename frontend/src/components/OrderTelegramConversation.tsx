import { useEffect, useId, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { API_URL } from "@/config/api"
import type { TelegramOrderReply } from "@/services/order.service"

const dateTime = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" })

const mediaLabels: Record<string, string> = {
  photo: "Foto", video: "Video", video_note: "Pesan video", animation: "Animasi",
  voice: "Pesan suara", audio: "Audio", sticker: "Stiker", sticker_video: "Stiker video",
  document: "Dokumen",
}
const mediaExtensions: Record<string, string> = {
  "image/jpeg": "jpg", "image/webp": "webp", "video/mp4": "mp4", "video/webm": "webm",
  "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/wav": "wav", "audio/webm": "webm",
}

export default function OrderTelegramConversation({ orderId, replies = [], token }: {
  orderId: number
  replies?: TelegramOrderReply[]
  token: string | null
}) {
  const headingId = useId()
  const entries = new Map<string, TelegramOrderReply[]>()
  for (const reply of replies) {
    const key = reply.album_id ? `album:${reply.album_id}` : `reply:${reply.id}`
    const entry = entries.get(key)
    if (entry) entry.push(reply)
    else entries.set(key, [reply])
  }

  return (
    <Card role="region" aria-labelledby={headingId}>
      <CardHeader>
        <CardTitle id={headingId}>Percakapan Telegram</CardTitle>
      </CardHeader>
      <CardContent>
        {entries.size === 0 ? (
          <p className="text-sm text-muted-foreground">Belum ada balasan Telegram yang tercatat untuk order ini.</p>
        ) : (
          <ol className="divide-y">
            {[...entries].map(([key, messages]) => {
              const first = messages[0]
              return (
                <li key={key} className="space-y-2 py-4 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="text-sm font-medium wrap-anywhere">{first.sender_name}</span>
                    <time dateTime={first.sent_at} className="text-xs text-muted-foreground">{dateTime.format(new Date(first.sent_at))}</time>
                  </div>
                  {first.reply_excerpt && (
                    <blockquote className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground wrap-anywhere whitespace-pre-wrap">
                      <span className="block text-xs font-medium">Membalas</span>
                      {first.reply_excerpt}
                    </blockquote>
                  )}
                  {messages.map((message) => (
                    <div key={message.id} className="space-y-2">
                      {message.content && <p className="text-sm wrap-anywhere whitespace-pre-wrap">{message.content}</p>}
                      {message.media_kind && <ConversationMedia orderId={orderId} message={message} token={token} />}
                    </div>
                  ))}
                </li>
              )
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  )
}

function ConversationMedia({ orderId, message, token }: {
  orderId: number
  message: TelegramOrderReply
  token: string | null
}) {
  const [attempt, setAttempt] = useState(0)
  const [media, setMedia] = useState<{ url: string; extension?: string } | null>(null)
  const [error, setError] = useState("")
  const kind = message.media_kind || "document"
  const label = mediaLabels[kind] || "Lampiran"

  useEffect(() => {
    if (!attempt || !token) return
    const controller = new AbortController()
    let url: string | undefined
    fetch(`${API_URL}/orders/${orderId}/conversation-media/${message.id}`, {
      headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) {
        const errorBody = await response.json().catch(() => null)
        throw new Error(errorBody?.message || "Lampiran belum dapat dimuat.")
      }
      const blob = await response.blob()
      if (controller.signal.aborted) return
      url = URL.createObjectURL(blob)
      setMedia({ url, extension: mediaExtensions[blob.type] })
    }).catch((failure) => {
      if (!controller.signal.aborted) setError(failure.message)
    })
    return () => {
      controller.abort()
      if (url) URL.revokeObjectURL(url)
    }
  }, [attempt, message.id, orderId, token])

  if (Number(message.file_size) > 20 * 1024 * 1024) {
    return <p className="text-sm text-muted-foreground">{message.file_name || label} · melebihi batas unduhan Telegram (20 MB)</p>
  }
  if (!media) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {message.file_name && <span className="wrap-anywhere">{message.file_name}</span>}
        {error && <span role="alert" className="text-destructive">{error}</span>}
        <Button type="button" size="sm" variant="outline" disabled={!token || (attempt > 0 && !error)}
          onClick={() => { setError(""); setAttempt((value) => value + 1) }}>
          {error ? "Coba lagi" : attempt ? "Memuat lampiran…" : `Buka ${label.toLowerCase()}`}
        </Button>
      </div>
    )
  }
  const filename = message.file_name || `telegram-${message.id}${media.extension ? `.${media.extension}` : ""}`
  return (
    <div className="space-y-1">
      {["photo", "sticker"].includes(kind) &&
        <img src={media.url} alt={label} className="max-h-80 max-w-full rounded-md object-contain" />}
      {["video", "video_note", "animation", "sticker_video"].includes(kind) &&
        <video src={media.url} controls playsInline className="max-h-80 w-full max-w-lg rounded-md" aria-label={label} />}
      {["voice", "audio"].includes(kind) &&
        <audio src={media.url} controls className="w-full max-w-sm" aria-label={label} />}
      <a href={media.url} download={filename} className="block text-sm text-primary underline underline-offset-2 wrap-anywhere">
        Unduh {message.file_name || label.toLowerCase()}
      </a>
    </div>
  )
}
