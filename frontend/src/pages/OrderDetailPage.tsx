import { useEffect, useState } from "react";

import { useNavigate, useParams } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import OrderStatusBadge from "@/components/OrderStatusBadge";

import { useAuth } from "@/contexts/AuthContext";

import {
  completeOrder,
  escalateOrder,
  getOrderDetail,
  getReassignTargets,
  reassignOrder,
  sendResult,
  type OrderDetail,
  type ReassignTarget,
} from "@/services/order.service";

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";

  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function OrderDetailPage() {
  const { token, user } = useAuth();
  const { id } = useParams();
  const navigate = useNavigate();

  const [detail, setDetail] = useState<OrderDetail | null>(null);

  const [loading, setLoading] = useState(true);

  const [error, setError] = useState("");

  const [actionLoading, setActionLoading] = useState(false);

  const [isReassignDialogOpen, setIsReassignDialogOpen] = useState(false);

  const [reassignTargets, setReassignTargets] = useState<ReassignTarget[]>([]);

  const [targetUserId, setTargetUserId] = useState("");

  const [reassignReason, setReassignReason] = useState("");

  const [reassignError, setReassignError] = useState("");

  const [isEscalateDialogOpen, setIsEscalateDialogOpen] = useState(false);

  const [escalateReason, setEscalateReason] = useState("");

  const [escalateError, setEscalateError] = useState("");

  const [isResultDialogOpen, setIsResultDialogOpen] = useState(false);

  const [resultContent, setResultContent] = useState("");

  const [resultError, setResultError] = useState("");

  const [resultFiles, setResultFiles] = useState<File[]>([]);

  const [resultImagePreviews, setResultImagePreviews] = useState<
    Record<string, string>
  >({});

  const [isCompleteDialogOpen, setIsCompleteDialogOpen] = useState(false);

  const [completeError, setCompleteError] = useState("");

  const [completeContent, setCompleteContent] = useState("");

  const [completeFiles, setCompleteFiles] = useState<File[]>([]);

  const [completeImagePreviews, setCompleteImagePreviews] = useState<
    Record<string, string>
  >({});

  async function loadDetail() {
    if (!token || !id) return;

    try {
      setLoading(true);
      setError("");

      const data = await getOrderDetail(token, Number(id));

      setDetail(data);
    } catch (error) {
      if (error instanceof Error) {
        setError(error.message);
      } else {
        setError("Gagal mengambil detail order");
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDetail();
  }, [token, id]);

  useEffect(() => {
    const previews = Object.fromEntries(
      resultFiles
        .filter((file) => file.type.startsWith("image/"))
        .map((file) => [
          `${file.name}-${file.lastModified}-${file.size}`,
          URL.createObjectURL(file),
        ]),
    );

    setResultImagePreviews(previews);

    return () => {
      Object.values(previews).forEach((url) => URL.revokeObjectURL(url));
    };
  }, [resultFiles]);

  useEffect(() => {
    const previews = Object.fromEntries(
      completeFiles
        .filter((file) => file.type.startsWith("image/"))
        .map((file) => [
          `${file.name}-${file.lastModified}-${file.size}`,
          URL.createObjectURL(file),
        ]),
    );

    setCompleteImagePreviews(previews);

    return () => {
      Object.values(previews).forEach((url) => URL.revokeObjectURL(url));
    };
  }, [completeFiles]);

  async function openReassignDialog() {
    if (!token || !id) return;

    try {
      setActionLoading(true);
      setReassignError("");

      const targets = await getReassignTargets(token, Number(id));

      setReassignTargets(targets);
      setTargetUserId("");
      setReassignReason("");
      setIsReassignDialogOpen(true);
    } catch (error) {
      setReassignError(
        error instanceof Error
          ? error.message
          : "Gagal mengambil daftar HD tujuan",
      );
    } finally {
      setActionLoading(false);
    }
  }

  async function handleReassign(
    event: React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (!token || !id) return;

    const selectedUserId = Number(targetUserId);

    if (!selectedUserId || !reassignReason.trim()) {
      setReassignError("Pilih HD tujuan dan isi alasan reassign");
      return;
    }

    try {
      setActionLoading(true);
      setReassignError("");

      await reassignOrder(
        token,
        Number(id),
        selectedUserId,
        reassignReason.trim(),
      );

      setIsReassignDialogOpen(false);
      await loadDetail();
    } catch (error) {
      setReassignError(
        error instanceof Error ? error.message : "Gagal reassign order",
      );
    } finally {
      setActionLoading(false);
    }
  }

  function openEscalateDialog() {
    setEscalateReason("");
    setEscalateError("");
    setIsEscalateDialogOpen(true);
  }

  async function handleEscalate(
    event: React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (!token || !id) return;

    if (!escalateReason.trim()) {
      setEscalateError("Alasan escalate wajib diisi");
      return;
    }

    try {
      setActionLoading(true);
      setEscalateError("");

      await escalateOrder(token, Number(id), escalateReason.trim());

      setIsEscalateDialogOpen(false);
      await loadDetail();
    } catch (error) {
      setEscalateError(
        error instanceof Error ? error.message : "Gagal escalate order",
      );
    } finally {
      setActionLoading(false);
    }
  }

  function openResultDialog() {
    setResultContent("");
    setResultError("");
    setResultFiles([]);
    setIsResultDialogOpen(true);
  }

  function addResultFiles(files: File[]) {
    const maxFileSize = 10 * 1024 * 1024;
    const availableSlots = 10 - resultFiles.length;

    const validFiles = files.filter((file) => file.size <= maxFileSize);

    if (validFiles.length !== files.length) {
      setResultError("Ukuran setiap file maksimal 10 MB");
    } else if (files.length > availableSlots) {
      setResultError("Maksimal 10 file dalam satu result");
    } else {
      setResultError("");
    }

    setResultFiles((currentFiles) => [
      ...currentFiles,
      ...validFiles.slice(0, Math.max(availableSlots, 0)),
    ]);
  }

  function handleResultPaste(event: React.ClipboardEvent<HTMLFormElement>) {
    const files = Array.from(event.clipboardData.files);

    if (files.length === 0) return;

    event.preventDefault();
    addResultFiles(files);
  }

  async function handleSendResult(
    event: React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (!token || !id) return;

    if (!resultContent.trim() && resultFiles.length === 0) {
      setResultError("Isi hasil pekerjaan atau pilih minimal satu file");
      return;
    }

    try {
      setActionLoading(true);
      setResultError("");

      await sendResult(token, Number(id), resultContent.trim(), resultFiles);

      setIsResultDialogOpen(false);
      await loadDetail();
    } catch (error) {
      setResultError(
        error instanceof Error ? error.message : "Gagal menyimpan result",
      );
    } finally {
      setActionLoading(false);
    }
  }

  function openCompleteDialog() {
    setCompleteError("");
    setCompleteContent("");
    setCompleteFiles([]);
    setIsCompleteDialogOpen(true);
  }

  function addCompleteFiles(files: File[]) {
    const maxFileSize = 10 * 1024 * 1024;
    const availableSlots = 10 - completeFiles.length;
    const validFiles = files.filter((file) => file.size <= maxFileSize);

    if (validFiles.length !== files.length) {
      setCompleteError("Ukuran setiap file maksimal 10 MB");
    } else if (files.length > availableSlots) {
      setCompleteError("Maksimal 10 file dalam satu result");
    } else {
      setCompleteError("");
    }

    setCompleteFiles((currentFiles) => [
      ...currentFiles,
      ...validFiles.slice(0, Math.max(availableSlots, 0)),
    ]);
  }

  function handleCompletePaste(event: React.ClipboardEvent<HTMLFormElement>) {
    const files = Array.from(event.clipboardData.files);

    if (files.length === 0) return;

    event.preventDefault();
    addCompleteFiles(files);
  }

  async function handleComplete(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!token || !id) return;

    const needsResult = detail?.results.length === 0;

    if (needsResult && !completeContent.trim() && completeFiles.length === 0) {
      setCompleteError("Isi hasil pekerjaan atau pilih minimal satu file");
      return;
    }

    try {
      setActionLoading(true);
      setCompleteError("");

      await completeOrder(
        token,
        Number(id),
        needsResult ? completeContent.trim() : "",
        needsResult ? completeFiles : [],
      );

      setIsCompleteDialogOpen(false);
      await loadDetail();
    } catch (error) {
      setCompleteError(
        error instanceof Error
          ? error.message
          : "Gagal menyelesaikan order",
      );
    } finally {
      setActionLoading(false);
    }
  }

  if (loading) {
    return <div className="p-6">Memuat detail order...</div>;
  }

  if (error) {
    return (
      <div className="p-6">
        <p className="text-destructive">{error}</p>
      </div>
    );
  }

  if (!detail) {
    return <div className="p-6">Order tidak ditemukan</div>;
  }

  const { order } = detail;

  const canReassign =
    order.status === "IN_PROGRESS" &&
    order.performance_owner_id === user?.id;

  const canSendResult =
    (order.status === "IN_PROGRESS" || order.status === "ESCALATED") &&
    order.performance_owner_id === user?.id;

  return (
    <div className="min-h-screen bg-muted p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="sticky top-0 z-20 -mx-6 flex flex-wrap gap-2 border-b bg-muted/95 px-6 py-3 backdrop-blur supports-[backdrop-filter]:bg-muted/75">
          {canReassign && (
            <Button
              variant="outline"
              onClick={openReassignDialog}
              disabled={actionLoading}
            >
              {actionLoading ? "Memuat..." : "Reassign"}
            </Button>
          )}

          {canSendResult && (
            <Button
              variant="outline"
              onClick={openResultDialog}
              disabled={actionLoading}
            >
              Send Result
            </Button>
          )}

          {canSendResult && (
            <Button
              onClick={openCompleteDialog}
              disabled={actionLoading}
            >
              Complete Order
            </Button>
          )}

          {canReassign && (
            <Button
              variant="outline"
              onClick={openEscalateDialog}
              disabled={actionLoading}
            >
              Escalate
            </Button>
          )}

          <Button variant="outline" onClick={() => navigate("/orders")}>
            Kembali
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Informasi Order</CardTitle>
          </CardHeader>

          <CardContent className="grid gap-4 md:grid-cols-2">
            <Info label="Ticket" value={order.ticket_number} />

            <Info label="Service" value={order.service_number} />

            <Info label="STO" value={order.sto} />

            <div>
              <div className="text-sm text-muted-foreground">Status</div>
              <div className="mt-1">
                <OrderStatusBadge status={order.status} />
              </div>
            </div>

            <Info label="Owner" value={order.performance_owner_name} />

            <Info label="Telegram Group" value={order.telegram_group} />

            <Info label="Dibuat" value={formatDateTime(order.created_at)} />

            <Info label="Selesai" value={formatDateTime(order.completed_at)} />

            <div className="md:col-span-2">
              <div className="text-sm text-muted-foreground">
                Pesan Asli Telegram
              </div>
              <pre className="mt-2 max-h-44 overflow-auto rounded-lg border bg-muted p-3 font-mono text-sm leading-relaxed whitespace-pre-wrap break-words text-foreground">
                {order.raw_message || order.description || "-"}
              </pre>
            </div>
          </CardContent>
        </Card>

        {reassignError && !isReassignDialogOpen && (
          <p className="text-sm text-destructive">{reassignError}</p>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Assignment History</CardTitle>
          </CardHeader>

          <CardContent className="space-y-3">
            {detail.assignments.map((assignment) => (
              <div key={assignment.id} className="rounded-lg border p-3">
                <div className="font-medium">{assignment.user_name}</div>

                <div className="text-sm text-muted-foreground">
                  {assignment.release_reason || "Aktif"} · {formatDateTime(assignment.assigned_at)}
                </div>
              </div>
            ))}

            {detail.assignments.length === 0 && (
              <p className="text-muted-foreground">Belum ada assignment</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Activity</CardTitle>
          </CardHeader>

          <CardContent className="space-y-3">
            {detail.events.map((event) => (
              <div key={event.id} className="border-l-2 pl-4">
                <div className="font-medium">{event.event_type}</div>

                <div className="text-sm text-muted-foreground">
                  {event.actor_name || "System"} · {formatDateTime(event.created_at)}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Notes</CardTitle>
          </CardHeader>

          <CardContent className="space-y-3">
            {detail.notes.map((note) => (
              <div key={note.id} className="rounded-lg border p-3">
                <div className="text-sm font-medium">
                  {note.note_type} · {note.user_name}
                </div>

                <p className="mt-1">{note.content}</p>

                <p className="mt-2 text-sm text-muted-foreground">
                  {formatDateTime(note.created_at)}
                </p>
              </div>
            ))}

            {detail.notes.length === 0 && (
              <p className="text-muted-foreground">Tidak ada catatan</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Results</CardTitle>
          </CardHeader>

          <CardContent className="space-y-4">
            {detail.results.map((result) => (
              <div key={result.id} className="rounded-lg border p-4">
                <div className="font-medium">{result.user_name}</div>

                {result.content && <p className="mt-2">{result.content}</p>}

                <p className="mt-2 text-sm text-muted-foreground">
                  {formatDateTime(result.created_at)}
                </p>

                {result.files.map((file) => (
                  <div key={file.id} className="mt-3">
                    {file.mime_type?.startsWith("image/") ? (
                      <a href={file.file_url} target="_blank" rel="noreferrer">
                        <img
                          src={file.file_url}
                          alt={file.file_name}
                          className="max-h-56 rounded-lg border object-contain"
                        />
                      </a>
                    ) : (
                      <a
                        href={file.file_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm text-primary hover:underline"
                      >
                        📎 {file.file_name}
                      </a>
                    )}
                  </div>
                ))}
              </div>
            ))}

            {detail.results.length === 0 && (
              <p className="text-muted-foreground">Belum ada hasil</p>
            )}
          </CardContent>
        </Card>
      </div>

      {isReassignDialogOpen && (
        <Dialog
          open={isReassignDialogOpen}
          onOpenChange={setIsReassignDialogOpen}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reassign Order</DialogTitle>
              <DialogDescription>
                Alihkan order ini ke HD lain yang sesuai city dan segment.
              </DialogDescription>
            </DialogHeader>

            <form className="space-y-4" onSubmit={handleReassign}>
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="target-user">
                    HD tujuan
                  </label>

                  <select
                    id="target-user"
                    className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
                    value={targetUserId}
                    onChange={(event) => setTargetUserId(event.target.value)}
                    disabled={actionLoading || reassignTargets.length === 0}
                  >
                    <option value="">Pilih HD tujuan</option>
                    {reassignTargets.map((target) => (
                      <option key={target.id} value={target.id}>
                        {target.name} (@{target.username}) — {target.active_orders}/10 aktif
                      </option>
                    ))}
                  </select>

                  {reassignTargets.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      Tidak ada HD yang tersedia untuk segment ini.
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="reassign-reason">
                    Alasan reassign
                  </label>

                  <Textarea
                    id="reassign-reason"
                    className="min-h-24"
                    value={reassignReason}
                    onChange={(event) => setReassignReason(event.target.value)}
                    placeholder="Jelaskan alasan pengalihan order"
                    disabled={actionLoading}
                  />
                </div>

                {reassignError && (
                  <p className="text-sm text-destructive">{reassignError}</p>
                )}

                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsReassignDialogOpen(false)}
                    disabled={actionLoading}
                  >
                    Batal
                  </Button>

                  <Button
                    type="submit"
                    disabled={
                      actionLoading ||
                      !targetUserId ||
                      !reassignReason.trim()
                    }
                  >
                    {actionLoading ? "Memproses..." : "Reassign Order"}
                  </Button>
                </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}

      {isEscalateDialogOpen && (
        <Dialog
          open={isEscalateDialogOpen}
          onOpenChange={setIsEscalateDialogOpen}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Escalate Order</DialogTitle>
              <DialogDescription>
                Catat alasan dan tujuan escalation untuk order ini.
              </DialogDescription>
            </DialogHeader>

            <form className="space-y-4" onSubmit={handleEscalate}>
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="escalate-reason">
                    Alasan dan tujuan escalation
                  </label>

                  <Textarea
                    id="escalate-reason"
                    className="min-h-28"
                    value={escalateReason}
                    onChange={(event) => setEscalateReason(event.target.value)}
                    placeholder="Contoh: Perlu bantuan Logic untuk pengecekan konfigurasi"
                    disabled={actionLoading}
                  />
                </div>

                {escalateError && (
                  <p className="text-sm text-destructive">{escalateError}</p>
                )}

                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsEscalateDialogOpen(false)}
                    disabled={actionLoading}
                  >
                    Batal
                  </Button>

                  <Button
                    type="submit"
                    disabled={actionLoading || !escalateReason.trim()}
                  >
                    {actionLoading ? "Memproses..." : "Escalate Order"}
                  </Button>
                </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}

      {isResultDialogOpen && (
        <Dialog
          open={isResultDialogOpen}
          onOpenChange={setIsResultDialogOpen}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Send Result</DialogTitle>
              <DialogDescription>
                Hasil disimpan ke sistem dan belum dikirim ke Telegram.
              </DialogDescription>
            </DialogHeader>

            <form
              className="space-y-4"
              onSubmit={handleSendResult}
              onPaste={handleResultPaste}
            >
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="result-content">
                    Hasil pekerjaan
                  </label>

                  <Textarea
                    id="result-content"
                    className="min-h-32"
                    value={resultContent}
                    onChange={(event) => setResultContent(event.target.value)}
                    placeholder="Tulis hasil atau update pekerjaan di sini"
                    disabled={actionLoading}
                  />

                  <p className="text-sm text-muted-foreground">
                    Hasil disimpan ke sistem. Pengiriman ke Telegram akan ditambahkan nanti.
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="result-files">
                    Lampiran
                  </label>

                  <input
                    id="result-files"
                    type="file"
                    multiple
                    className="block w-full cursor-pointer rounded-lg border bg-background px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1 file:text-sm file:font-medium"
                    disabled={actionLoading}
                    onChange={(event) =>
                      addResultFiles(Array.from(event.target.files || []))
                    }
                  />

                  <p className="text-xs text-muted-foreground">
                    Maksimal 10 file, masing-masing hingga 10 MB. Semua format file
                    didukung, termasuk KML dan DWG. Anda juga dapat copy-paste file
                    atau screenshot langsung di dialog ini.
                  </p>

                  {resultFiles.length > 0 && (
                    <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-medium">
                          {resultFiles.length} file siap dikirim
                        </p>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setResultFiles([])}
                          disabled={actionLoading}
                        >
                          Hapus semua
                        </Button>
                      </div>
                      <ul className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
                        {resultFiles.map((file) => (
                          <li
                            key={`${file.name}-${file.lastModified}-${file.size}`}
                            className="rounded-md border bg-background p-2"
                          >
                            {file.type.startsWith("image/") &&
                            resultImagePreviews[
                              `${file.name}-${file.lastModified}-${file.size}`
                            ] ? (
                              <img
                                src={
                                  resultImagePreviews[
                                    `${file.name}-${file.lastModified}-${file.size}`
                                  ]
                                }
                                alt={file.name}
                                className="mb-2 h-28 w-full rounded object-cover"
                              />
                            ) : null}
                            <span className="break-all">📎 {file.name}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                {resultError && (
                  <p className="text-sm text-destructive">{resultError}</p>
                )}

                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsResultDialogOpen(false)}
                    disabled={actionLoading}
                  >
                    Batal
                  </Button>

                  <Button
                    type="submit"
                    disabled={
                      actionLoading ||
                      (!resultContent.trim() && resultFiles.length === 0)
                    }
                  >
                    {actionLoading ? "Menyimpan..." : "Simpan Result"}
                  </Button>
                </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}

      {isCompleteDialogOpen && (
        <Dialog
          open={isCompleteDialogOpen}
          onOpenChange={setIsCompleteDialogOpen}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Complete Order</DialogTitle>
              <DialogDescription>
                {detail.results.length === 0
                  ? "Tambahkan hasil pekerjaan sebelum order diselesaikan."
                  : "Tandai order ini sebagai selesai? Status akan berubah menjadi DONE."}
              </DialogDescription>
            </DialogHeader>

            <form
              className="space-y-4"
              onSubmit={handleComplete}
              onPaste={handleCompletePaste}
            >
              {detail.results.length === 0 && (
                <>
                  <div className="space-y-2">
                    <label className="text-sm font-medium" htmlFor="complete-content">
                      Hasil pekerjaan
                    </label>
                    <Textarea
                      id="complete-content"
                      className="min-h-28"
                      value={completeContent}
                      onChange={(event) => setCompleteContent(event.target.value)}
                      placeholder="Tulis ringkasan hasil penyelesaian"
                      disabled={actionLoading}
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium" htmlFor="complete-files">
                      Lampiran
                    </label>
                    <input
                      id="complete-files"
                      type="file"
                      multiple
                      className="block w-full cursor-pointer rounded-lg border bg-background px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1 file:text-sm file:font-medium"
                      disabled={actionLoading}
                      onChange={(event) =>
                        addCompleteFiles(Array.from(event.target.files || []))
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      Hasil berupa teks atau minimal satu file wajib diisi. File dapat
                      dipilih atau di-paste langsung di dialog ini.
                    </p>
                    {completeFiles.length > 0 && (
                      <ul className="grid gap-2 rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground sm:grid-cols-2">
                        {completeFiles.map((file) => (
                          <li
                            key={`${file.name}-${file.lastModified}-${file.size}`}
                            className="rounded-md border bg-background p-2"
                          >
                            {file.type.startsWith("image/") &&
                            completeImagePreviews[
                              `${file.name}-${file.lastModified}-${file.size}`
                            ] ? (
                              <img
                                src={
                                  completeImagePreviews[
                                    `${file.name}-${file.lastModified}-${file.size}`
                                  ]
                                }
                                alt={file.name}
                                className="mb-2 h-28 w-full rounded object-cover"
                              />
                            ) : null}
                            <span className="break-all">📎 {file.name}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </>
              )}

              {completeError && (
                <p className="text-sm text-destructive">{completeError}</p>
              )}

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsCompleteDialogOpen(false)}
                  disabled={actionLoading}
                >
                  Batal
                </Button>

                <Button
                  type="submit"
                  disabled={
                    actionLoading ||
                    (detail.results.length === 0 &&
                      !completeContent.trim() &&
                      completeFiles.length === 0)
                  }
                >
                  {actionLoading
                    ? "Memproses..."
                    : detail.results.length === 0
                      ? "Simpan Hasil & Selesaikan"
                      : "Ya, Selesaikan"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function Info({
  label,
  value,
}: {
  label: string;
  value: string | number | null | undefined;
}) {
  return (
    <div>
      <div className="text-sm text-muted-foreground">{label}</div>

      <div className="font-medium">{value ?? "-"}</div>
    </div>
  );
}
