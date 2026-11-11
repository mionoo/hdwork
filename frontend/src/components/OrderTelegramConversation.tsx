import { useEffect, useId, useRef, useState, type ClipboardEvent, type FormEvent } from "react"
import { Reply, ZoomIn, ZoomOut } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { API_URL } from "@/config/api"
import { getTelegramReplyDelivery, sendTelegramOrderReply, type TelegramOrderReply } from "@/services/order.service"

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

export default function OrderTelegramConversation({ orderId, replies = [], token, canReply = false }: {
  orderId: number
  replies?: TelegramOrderReply[]
  token: string | null
  canReply?: boolean
}) {
  const headingId = useId()
  const [updatedReplies, setUpdatedReplies] = useState<TelegramOrderReply[] | null>(null)
  const [targetId, setTargetId] = useState<number | null>(null)
  const [sending, setSending] = useState(false)
  const [notice, setNotice] = useState("")
  const [deliveryId, setDeliveryId] = useState<string | null>(null)
  useEffect(() => {
    if (!deliveryId || !token) return
    const authToken = token
    const jobId = deliveryId
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>

    async function checkDelivery() {
      try {
        const result = await getTelegramReplyDelivery(authToken, orderId, jobId, controller.signal)
        if (controller.signal.aborted) return
        switch (result.delivery_status) {
          case "pending":
          case "sending":
            timer = setTimeout(checkDelivery, 3000)
            return
          case "sent":
            if (result.replies) setUpdatedReplies(result.replies)
            setNotice(result.warning || "Balasan terkirim ke Telegram.")
            break
          case "failed":
            setNotice("Balasan gagal dikirim. Periksa pesan tujuan dan koneksi Telegram.")
            break
          case "unknown":
            setNotice("Pengiriman balasan belum terkonfirmasi. Periksa grup sebelum mengirim ulang.")
            break
        }
        setDeliveryId(null)
      } catch {
        if (controller.signal.aborted) return
        setNotice("Status balasan tidak dapat dimuat. Periksa grup sebelum mengirim ulang.")
        setDeliveryId(null)
      }
    }

    timer = setTimeout(checkDelivery, 1000)
    return () => { controller.abort(); clearTimeout(timer) }
  }, [deliveryId, token, orderId])
  useEffect(() => { setUpdatedReplies(null) }, [replies])
  const entries = new Map<string, TelegramOrderReply[]>()
  for (const reply of updatedReplies ?? replies) {
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
                    {Boolean(first.is_outbound) && <span className="text-xs font-medium text-primary">Dari HD Work</span>}
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
                      {canReply && token && (targetId === message.id ? (
                        <ReplyComposer message={message} sending={sending}
                          onCancel={() => setTargetId(null)}
                          onSend={async (content, file) => {
                            setSending(true)
                            setNotice("")
                            try {
                              const result = await sendTelegramOrderReply(token, orderId, message.id, content, file)
                              if (result.replies) setUpdatedReplies(result.replies)
                              setDeliveryId(result.delivery_id ?? null)
                              setNotice(result.delivery_id
                                ? "Balasan masuk antrean Telegram."
                                : result.warning || "Balasan terkirim ke Telegram.")
                              setTargetId(null)
                            } finally {
                              setSending(false)
                            }
                          }} />
                      ) : (
                        <Button type="button" size="sm" variant="ghost" disabled={sending}
                          aria-label={`Balas pesan dari ${message.sender_name}`}
                          onClick={() => { setNotice(""); setTargetId(message.id) }}>
                          <Reply aria-hidden="true" /> Balas
                        </Button>
                      ))}
                    </div>
                  ))}
                </li>
              )
            })}
          </ol>
        )}
        {notice && <p role="status" className="mt-3 text-sm text-muted-foreground">{notice}</p>}
      </CardContent>
    </Card>
  )
}

function ReplyComposer({ message, sending, onSend, onCancel }: {
  message: TelegramOrderReply
  sending: boolean
  onSend: (content: string, file: File | null) => Promise<void>
  onCancel: () => void
}) {
  const id = useId()
  const input = useRef<HTMLTextAreaElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const [content, setContent] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState("")
  const [preview, setPreview] = useState<string | null>(null)
  useEffect(() => {
    if (!file?.type.startsWith("image/")) { setPreview(null); return }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  function selectFile(attachment: File | null) {
    if (attachment && (!attachment.size || attachment.size > 10 * 1024 * 1024)) {
      setError("Pilih file berisi data dengan ukuran maksimal 10 MB.")
      return
    }
    setError("")
    setFile(attachment)
  }

  function pasteAttachment(event: ClipboardEvent<HTMLFormElement>) {
    const files = Array.from(event.clipboardData.files)
    if (!files.length || sending) return
    event.preventDefault()
    if (files.length > 1) {
      setError("Satu balasan hanya dapat memuat 1 lampiran. Salin satu file lalu tempel kembali.")
      return
    }
    selectFile(files[0])
    if (fileInput.current) fileInput.current.value = ""
  }

  const maxLength = file ? 1024 : 4096
  useEffect(() => { input.current?.focus() }, [])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (sending || (!content.trim() && !file) || content.trim().length > maxLength) return
    setError("")
    try { await onSend(content.trim(), file) }
    catch (failure) {
      setError(failure instanceof Error ? failure.message : "Balasan belum dapat dikirim.")
    }
  }

  return (
    <form onSubmit={submit} onPaste={pasteAttachment} className="space-y-3 rounded-md border bg-muted/40 p-3">
      <blockquote className="text-sm text-muted-foreground">
        <span className="block font-medium wrap-anywhere">Membalas {message.sender_name}</span>
        <span className="line-clamp-2 wrap-anywhere">{message.content || message.file_name || "Lampiran Telegram"}</span>
      </blockquote>
      <Textarea ref={input} aria-label="Tulis balasan" placeholder="Tulis balasan…" rows={3}
        value={content} disabled={sending} aria-describedby={`${id}-paste-hint`} onChange={(event) => setContent(event.target.value)} />
      <p id={`${id}-paste-hint`} className="text-xs text-muted-foreground">Tempel gambar atau file dari clipboard dengan Ctrl+V / ⌘V, atau pilih lampiran.</p>
      <div className="space-y-1">
        <label htmlFor={`${id}-file`} className="block text-xs font-medium">Lampiran opsional · 1 file, maks. 10 MB</label>
        <input ref={fileInput} id={`${id}-file`} type="file" disabled={sending} className="block w-full min-w-0 text-sm file:mr-2 file:rounded-md file:border file:bg-background file:px-2 file:py-1"
          onChange={(event) => {
            selectFile(event.currentTarget.files?.[0] ?? null)
            event.currentTarget.value = ""
          }} />
        {file && (
          <div className="space-y-2 pt-2">
            {preview && <img src={preview} alt="Pratinjau lampiran balasan" className="max-h-40 max-w-full rounded-md object-contain" />}
            <div className="flex flex-wrap items-center gap-2">
              <span role="status" className="min-w-0 text-sm wrap-anywhere">{file.name} · {(file.size / 1024).toLocaleString("id-ID", { maximumFractionDigits: 1 })} KB</span>
              <Button type="button" size="sm" variant="outline" disabled={sending} onClick={() => selectFile(null)}>Hapus lampiran</Button>
            </div>
          </div>
        )}
      </div>
      {content.trim().length > maxLength && <p className="text-sm text-destructive">Balasan maksimal {maxLength} karakter.</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" size="sm" variant="outline" disabled={sending} onClick={onCancel}>Batal</Button>
        <Button type="submit" size="sm" disabled={sending || (!content.trim() && !file) || content.trim().length > maxLength}>
          {sending ? "Mengirim…" : "Kirim balasan"}
        </Button>
      </div>
    </form>
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
  const isPhoto = kind === "photo"
  const tooLarge = Number(message.file_size) > 20 * 1024 * 1024
  const previewRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const preview = previewRef.current
    if (!isPhoto || tooLarge || !token || !preview || attempt) return
    if (typeof IntersectionObserver === "undefined") {
      setAttempt(1)
      return
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        observer.disconnect()
        setAttempt(1)
      }
    })
    observer.observe(preview)
    return () => observer.disconnect()
  }, [attempt, isPhoto, token, tooLarge])

  useEffect(() => {
    if (!attempt || !token || tooLarge) return
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
  }, [attempt, message.id, orderId, token, tooLarge])

  if (tooLarge) {
    return <p className="text-sm text-muted-foreground">{message.file_name || label} · melebihi batas unduhan Telegram (20 MB)</p>
  }
  if (!media) {
    if (isPhoto && !error) {
      return (
        <div ref={previewRef} role="status"
          className="flex aspect-[4/3] w-full max-w-60 items-center justify-center rounded-md border bg-muted p-3 text-center text-sm text-muted-foreground">
          {attempt ? "Memuat foto…" : "Pratinjau foto"}
        </div>
      )
    }
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
      {isPhoto && <ZoomableConversationPhoto url={media.url} filename={filename}
        onError={() => { setMedia(null); setError("Foto belum dapat dimuat.") }} />}
      {kind === "sticker" &&
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

function ZoomableConversationPhoto({ url, filename, onError }: {
  url: string
  filename: string
  onError: () => void
}) {
  const [open, setOpen] = useState(false)
  const [zoom, setZoom] = useState(100)
  const previewButton = useRef<HTMLButtonElement>(null)

  return (
    <>
      <Button ref={previewButton} type="button" variant="outline" aria-label="Perbesar foto"
        className="relative block h-auto w-full max-w-60 overflow-hidden p-0"
        onClick={() => { setZoom(100); setOpen(true) }}>
        <img src={url} alt="Foto dalam percakapan Telegram" onError={onError}
          className="aspect-[4/3] w-full bg-muted object-contain" />
        <span className="absolute right-2 bottom-2 grid size-7 place-items-center rounded-md border bg-background">
          <ZoomIn aria-hidden="true" />
        </span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent finalFocus={previewButton} className="max-w-5xl space-y-3 p-3 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <DialogTitle>Foto Telegram</DialogTitle>
              <DialogDescription className="sr-only">Perbesar atau perkecil foto untuk melihat detailnya.</DialogDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" size="icon" variant="outline" aria-label="Perkecil foto"
                disabled={zoom === 100} onClick={() => setZoom((value) => value - 50)}>
                <ZoomOut aria-hidden="true" />
              </Button>
              <output aria-live="polite" className="w-11 text-center text-sm tabular-nums">{zoom}%</output>
              <Button type="button" size="icon" variant="outline" aria-label="Tambah zoom foto"
                disabled={zoom === 300} onClick={() => setZoom((value) => value + 50)}>
                <ZoomIn aria-hidden="true" />
              </Button>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Tutup</Button>
            </div>
          </div>
          <div className="h-[60svh] overflow-auto rounded-md bg-muted">
            <img src={url} alt="Foto dalam percakapan Telegram"
              className="block max-w-none object-contain" style={{ width: `${zoom}%`, height: `${zoom * 0.6}svh` }} />
          </div>
          <a href={url} download={filename} className="inline-block text-sm text-primary underline underline-offset-2">Unduh foto</a>
        </DialogContent>
      </Dialog>
    </>
  )
}
