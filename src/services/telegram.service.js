const { CACTI_ENABLED = false } = require("../config/features");
const { Markup, Telegraf } = require("telegraf");
const { setTimeout: delay } = require("node:timers/promises");
const { Agent } = require("node:https");
const telegramRepository = require("../repositories/telegram.repository");
const orderRepository = require("../repositories/order.repository");
const realtimeService = require("../services/realtime.service");
const orderSourceRepository = require("../repositories/order-source.repository");
const conversationRepository = require("../repositories/order-conversation.repository");
const { ensurePhoto, ensureTelegramFile } = require("./order-source-photo.service");

function telegramErrorMessage(error) {
  const message = String(error?.message || "Kesalahan Telegram");
  const code = error?.cause?.code || error?.code;
  return `${message}${code ? ` (${code})` : ""}`
    .replace(/bot\d+:[A-Za-z0-9_-]+/g, "bot[REDACTED]");
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

const bot = process.env.TELEGRAM_BOT_TOKEN
  ? new Telegraf(process.env.TELEGRAM_BOT_TOKEN, {
    telegram: { agent: new Agent({ keepAlive: false }) },
  })
  : null;
const PERSONAL_ALARM_RATE_PER_SECOND = positiveInteger(process.env.TELEGRAM_PERSONAL_ALARM_RATE_PER_SECOND, 25);
const PERSONAL_ALARM_RETRY_LIMIT = positiveInteger(process.env.TELEGRAM_PERSONAL_ALARM_RETRY_LIMIT, 3);
const PERSONAL_ALARM_INTERVAL_MS = Math.ceil(1000 / PERSONAL_ALARM_RATE_PER_SECOND);
const DATIN_INSTITUTIONS_PER_PAGE = 8;
const POLLING_RETRY_DELAYS = [2000, 4000, 8000, 16000, 30000];
const POLLING_REQUEST_TIMEOUT_MS = 10000;
const TELEGRAM_REQUEST_TIMEOUT_MS = 20000;
const TELEGRAM_POLL_SECONDS = Math.min(50, positiveInteger(process.env.TELEGRAM_POLL_SECONDS, 10));
const TELEGRAM_DEBUG_LOGS = process.env.TELEGRAM_DEBUG_LOGS === "true";
const TELEGRAM_POLL_TIMEOUT_MS = (TELEGRAM_POLL_SECONDS + 15) * 1000;
const INCOMING_DATABASE_RETRY_DELAYS = [200, 500, 1000];
const TRANSIENT_DATABASE_ERRORS = new Set([
  "ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT", "ECONNRESET", "ETIMEDOUT",
  "PROTOCOL_CONNECTION_LOST", "ECONNREFUSED",
]);
let handlersRegistered = false;
let pollingTask;
let pollingController;
let pollingActive = false;
let lastPollingTimeoutAt = 0;
let previousPollFinishedAt = 0;
let personalAlarmQueue = Promise.resolve();
let nextPersonalAlarmAt = 0;
const orderMessageQueues = new Map();
const outgoingMessageQueues = new Map();
const replyMessageQueues = new Map();
const outgoingReceipts = new Map();
const limitedTelegramClients = new WeakSet();
const pendingReplyAlbums = new Map();
const REPLY_ALBUM_WINDOW_MS = 30_000;
const MAX_PENDING_REPLY_ALBUMS = 100;

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isGroupChat(chat) {
  return chat?.type === "group" || chat?.type === "supergroup";
}

function getThreadId(message) {
  return message?.is_topic_message ? message.message_thread_id : 0;
}

async function queueOutgoingMessage(chatId, threadId, work) {
  return queueTelegramWork(outgoingMessageQueues, chatId, threadId, work);
}

async function queueTelegramWork(queues, chatId, threadId, work) {
  const key = `${chatId}:${threadId || 0}`;
  const previous = queues.get(key);
  const task = (previous?.catch(() => {}) ?? Promise.resolve()).then(work);
  queues.set(key, task);
  try {
    return await task;
  } finally {
    if (queues.get(key) === task) queues.delete(key);
  }
}

async function trackOutgoingReceipt(chatId, threadId, sendAndRecord) {
  const key = `${chatId}:${threadId || 0}`;
  const task = Promise.resolve().then(sendAndRecord);
  outgoingReceipts.set(key, task);
  try {
    return await task;
  } finally {
    if (outgoingReceipts.get(key) === task) outgoingReceipts.delete(key);
  }
}

function limitTelegramRequests(telegram) {
  if (!telegram?.callApi || limitedTelegramClients.has(telegram)) return;
  limitedTelegramClients.add(telegram);
  const callApi = telegram.callApi.bind(telegram);
  telegram.callApi = async (method, payload, options = {}) => {
    const longPolling = method === "getUpdates" && Number(payload.timeout) > 0;
    const startedAt = Date.now();
    const gap = previousPollFinishedAt ? startedAt - previousPollFinishedAt : 0;
    if (TELEGRAM_DEBUG_LOGS && longPolling && gap > 1000) console.warn("Jeda sebelum polling Telegram", { gap_ms: gap });
    const requestPayload = longPolling ? { ...payload, timeout: TELEGRAM_POLL_SECONDS } : payload;
    const controller = new AbortController();
    const stop = () => controller.abort();
    const signal = options.signal;
    if (signal?.aborted) stop();
    else signal?.addEventListener("abort", stop, { once: true });
    const timeoutMs = longPolling ? TELEGRAM_POLL_TIMEOUT_MS : TELEGRAM_REQUEST_TIMEOUT_MS;
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
    try {
      const response = await callApi(method, requestPayload, { ...options, signal: controller.signal });
      if (longPolling) {
        lastPollingTimeoutAt = 0;
        if (TELEGRAM_DEBUG_LOGS && response.length) console.log("Batch Telegram diterima", {
          updates: response.length, request_ms: Date.now() - startedAt,
          poll_gap_ms: gap, at: new Date().toISOString(),
        });
      }
      return response;
    } catch (error) {
      if (!timedOut) throw error;
      if (longPolling) lastPollingTimeoutAt = Date.now();
      console.warn("Permintaan Telegram melewati batas waktu", { method, timeout_ms: timeoutMs });
      // Telegraf treats AbortError as a deliberate polling stop. Timeouts must retry instead.
      throw Object.assign(new Error(`Permintaan Telegram ${method} melewati batas waktu.`), { name: "FetchError", code: "ETIMEDOUT" });
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", stop);
      if (longPolling) previousPollFinishedAt = Date.now();
    }
  };
}

if (bot) limitTelegramRequests(bot.telegram);

function threadOptions(message) {
  const threadId = getThreadId(message);
  return threadId ? { message_thread_id: threadId } : {};
}

function groupName(chat, threadId) {
  const name = chat.title || `Telegram group ${chat.id}`;
  return threadId ? `${name} · Topic ${threadId}` : name;
}

async function isGroupAdmin(chatId, userId) {
  const member = await bot.telegram.getChatMember(chatId, userId);
  return member.status === "administrator" || member.status === "creator";
}

function cityKeyboard(cities) {
  return Markup.inlineKeyboard(cities.map((city) => [
    Markup.button.callback(city.name, `setgroup:city:${city.id}`),
  ]));
}

function segmentKeyboard(cityId, segments) {
  return Markup.inlineKeyboard(segments.map((segment) => [
    Markup.button.callback(segment.code === "REPLACE_ONT" ? "Replace ONT" : segment.code, `setgroup:segment:${cityId}:${segment.id}`),
  ]));
}

function workflowKeyboard(cityId, segmentId) {
  return Markup.inlineKeyboard([[
    Markup.button.callback("Assurance", `setgroup:flow:${cityId}:${segmentId}:A`),
    Markup.button.callback("Provisioning", `setgroup:flow:${cityId}:${segmentId}:P`),
  ]]);
}

function categoryKeyboard(cityId, segmentId, workflowCode) {
  return Markup.inlineKeyboard([[
    Markup.button.callback("Pengawalan", `setgroup:type:${cityId}:${segmentId}:${workflowCode}:PENGAWALAN`),
    Markup.button.callback("Logic", `setgroup:type:${cityId}:${segmentId}:${workflowCode}:LOGIC`),
  ]]);
}


function datinButtonLabel(name, selected) {
  const prefix = selected ? "✅ " : "▫️ ";
  return `${prefix}${String(name).slice(0, 57 - prefix.length)}`;
}

function datinInstitutionKeyboard({ institutions, selectedIds, page, total, pageSize }) {
  const selected = new Set(selectedIds);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const rows = institutions.map((institution) => [
    Markup.button.callback(
      datinButtonLabel(institution.name, selected.has(Number(institution.id))),
      `alarmdatin:toggle:${institution.id}:${page}`,
    ),
  ]);
  const navigation = [];
  if (page > 0) navigation.push(Markup.button.callback("← Sebelumnya", `alarmdatin:page:${page - 1}`));
  if (page < totalPages - 1) navigation.push(Markup.button.callback("Berikutnya →", `alarmdatin:page:${page + 1}`));
  if (navigation.length) rows.push(navigation);
  rows.push([
    Markup.button.callback("Kosongkan", `alarmdatin:clear:${page}`),
    Markup.button.callback("Simpan", "alarmdatin:done"),
  ]);
  return Markup.inlineKeyboard(rows);
}

function parseIncomingOrder(text) {
  const req = text.match(/^#req\s+([^,\s]+)\s*,\s*(.+)$/is);
  if (req) return { orderType: "REQ", serviceNumber: req[1], description: req[2].trim(), metadata: {} };
  const assign = text.match(/^#assign\s+([^,\s]+)\s*,\s*(.+)$/i);
  if (assign) {
    const description = assign[2].trim();
    return { orderType: "ASSIGN", ticketNumber: assign[1], description, metadata: { crew: description.split(/\s+/)[0] } };
  }
  return null;
}

function parseConfigOrder(text) {
  const command = text.match(/^\/config(?:@\w+)?(?:\s|\n|$)/i);
  if (!command) return null;

  const fields = {};
  text
    .slice(command[0].length)
    .split(/\r?\n/)
    .forEach((line) => {
      const match = line.match(/^\s*([^:]+?)\s*:\s*(.*?)\s*$/);
      if (match) fields[match[1].trim().toUpperCase()] = match[2].trim();
    });

  const serviceLine = fields["NO SERVICE"] || "";
  const serviceNumber = serviceLine.match(/^([^\s,]+)/)?.[1];
  const tel1 = serviceLine.match(/\btel\s*1\s*[:=]?\s*([^,\s]+)/i)?.[1];
  const tel2 = serviceLine.match(/\btel\s*2\s*[:=]?\s*([^,\s]+)/i)?.[1];

  if (!fields.TIKET || !serviceNumber || !fields.KETERANGAN) return null;

  return {
    orderType: "CONFIG",
    ticketNumber: fields.TIKET,
    serviceNumber,
    description: fields.KETERANGAN,
    oldOntSerial: fields["SN ONT LAMA"] || null,
    newOntSerial: fields["SN ONT BARU"] || null,
    sto: fields.STO || null,
    valinId: fields["VALIN ID"] || null,
    metadata: {
      ...(tel1 ? { tel1 } : {}),
      ...(tel2 ? { tel2 } : {}),
    },
  };
}

function helpMessage() {
  return [
    "###### FORMAT ORDER ######",
    "",
    "## CEK DATA ##",
    "#req nomor service, keterangan",
    "Contoh:",
    "#req 1523xxxxx, moban embassy ncx alamat dan lain",
    "",
    "## ORDER ASSIGN DAN REASSIGN ##",
    "#assign nomor tiket, crew keterangan",
    "Contoh:",
    "#assign IN12XXX, F5RKT2XX assign mi dan bromo",
    "",
    "## ORDER CONFIG ##",
    "/config",
    "TIKET : IN123XXX",
    "NO SERVICE : 1523XXX tel1 03156xx, tel2 03157xx",
    "SN ONT LAMA : ZTEGXXXXX",
    "SN ONT BARU : ALCLXXXX",
    "STO : GBG",
    "VALIN ID : 121212",
    "KETERANGAN : konfik inet nok",
    "",
    ...(CACTI_ENABLED ? [
    "## ALARM PERSONAL ##",
    "Kirim di chat pribadi bot:",
    "/alarmdatin atau /alarmnodeb untuk mulai menerima alarm ONT down",
    "/stopalarmdatin atau /stopalarmnodeb untuk berhenti",
    "/alarmstatus untuk melihat alarm yang aktif",
    ] : []),
  ].join("\n");
}

async function replyWrongOrderGroup(ctx, message) {
  // Feedback must not keep Telegram's incoming batch waiting on a network send.
  void queueOutgoingMessage(ctx.chat.id, getThreadId(ctx.message), () => ctx.reply(message, {
    ...threadOptions(ctx.message), reply_to_message_id: ctx.message.message_id,
  })).catch((error) => {
    console.error("Pemberitahuan format grup gagal dikirim:", telegramErrorMessage(error));
  });
}

async function ingestParsedOrder(ctx, parsed, category, formatWarning, knownGroup) {
  const message = ctx.message;
  const lookupAt = Date.now();
  const group = knownGroup ?? await telegramRepository.getGroupByChatThread(ctx.chat.id, getThreadId(message));
  ctx.orderMetrics = { group_lookup_ms: Date.now() - lookupAt };
  if (!group?.is_active) return;
  if (group.category !== category) {
    await replyWrongOrderGroup(ctx, formatWarning);
    return;
  }
  const order = await orderRepository.createIncomingOrder({ group, message, ...parsed });
  ctx.orderMetrics = { ...ctx.orderMetrics, ...order?.timings, order_id: order?.id ?? null };
  // Emit even after an uncertain commit: a retry may find the order already saved.
  realtimeService.emitOrdersChanged();
}

async function ingestIncomingOrder(ctx, knownGroup) {
  const text = ctx.message?.text || ctx.message?.caption;
  if (!isGroupChat(ctx.chat) || !text) return;
  const parsed = parseIncomingOrder(text.trim());
  if (!parsed) return;
  return ingestParsedOrder(ctx, parsed, "PENGAWALAN",
    "⚠️ Format #req / #assign hanya dapat dikirim di grup Pengawalan.", knownGroup);
}

async function ingestConfigOrder(ctx, knownGroup) {
  const text = ctx.message?.text || ctx.message?.caption;
  if (!isGroupChat(ctx.chat) || !text) return;
  const parsed = parseConfigOrder(text.trim());
  if (!parsed) return;
  return ingestParsedOrder(ctx, parsed, "LOGIC",
    "⚠️ Format /config hanya dapat dikirim di grup Logic.", knownGroup);
}

async function ingestPhotoOrder(ctx) {
  const message = ctx.message;
  if (!isGroupChat(ctx.chat) || !message?.photo?.length) return;
  const caption = message.caption?.trim() || "";
  const incoming = parseIncomingOrder(caption);
  const config = parseConfigOrder(caption);
  // Captionless album members are retained until their caption arrives.
  if (!incoming && !config && !message.media_group_id) return;
  const lookupAt = Date.now();
  const group = await telegramRepository.getGroupByChatThread(ctx.chat.id, getThreadId(message));
  const groupLookupMs = Date.now() - lookupAt;
  if (!group?.is_active || !["PENGAWALAN", "LOGIC"].includes(group.category)) return;
  if ((incoming && group.category !== "PENGAWALAN") || (config && group.category !== "LOGIC")) {
    await replyWrongOrderGroup(ctx, "⚠️ Format caption tidak sesuai jenis grup. #req/#assign untuk Pengawalan; /config untuk Logic.");
    return;
  }
  await orderSourceRepository.record(group, message);
  if (incoming) await ingestIncomingOrder(ctx, group);
  else if (config) await ingestConfigOrder(ctx, group);
  if (ctx.orderMetrics) ctx.orderMetrics.group_lookup_ms = groupLookupMs;
  const orderId = await orderSourceRepository.link(group, message);
  if (!orderId) return;
  // File references are durable. Download photos through the authorized API when opened.
  realtimeService.emitOrdersChanged();
}

async function getSourcePhoto(photo) {
  if (!bot) throw Object.assign(new Error("Bot Telegram tidak tersedia"), { statusCode: 503 });
  return ensurePhoto(photo, bot.telegram);
}

async function getConversationMedia(file) {
  if (!bot) throw Object.assign(new Error("Bot Telegram tidak tersedia"), { statusCode: 503 });
  return ensureTelegramFile(file, bot.telegram, true);
}

function replyMedia(message) {
  if (message.photo?.length) return { kind: "photo", file: message.photo.at(-1) };
  if (message.sticker?.is_video) return { kind: "sticker_video", file: message.sticker };
  if (message.sticker?.is_animated) {
    return { kind: "document", file: { ...message.sticker, file_name: "stiker.tgs" } };
  }
  const kind = ["animation", "video", "video_note", "voice", "audio", "sticker", "document"]
    .find((type) => message[type]?.file_id);
  return kind ? { kind, file: message[kind] } : null;
}

async function sendConversationReply({ orderId, replyId, userId, target, content, attachment }) {
  if (!bot) throw Object.assign(new Error("Bot Telegram tidak tersedia"), { statusCode: 503 });
  const chatId = target.chat_id;
  const threadId = Number(target.thread_id);
  return queueOutgoingMessage(chatId, threadId, () => trackOutgoingReceipt(chatId, threadId, async () => {
    const currentTarget = await conversationRepository.findReplyTarget(orderId, replyId, userId);
    if (!currentTarget) {
      throw Object.assign(new Error("Pesan tujuan atau akses order sudah berubah."), { statusCode: 409 });
    }
    const options = {
      ...(threadId ? { message_thread_id: threadId } : {}),
      reply_parameters: { message_id: Number(target.message_id), allow_sending_without_reply: false },
    };
    let message;
    try {
      if (attachment) {
        const method = {
          "image/jpeg": "sendPhoto", "image/png": "sendPhoto",
          "video/mp4": "sendVideo", "audio/mpeg": "sendAudio", "audio/mp4": "sendAudio",
        }[attachment.mimetype] || "sendDocument";
        message = await bot.telegram[method](chatId, { source: attachment.path, filename: attachment.originalname }, {
          ...options, ...(content ? { caption: content } : {}),
        });
      } else {
        message = await bot.telegram.sendMessage(chatId, content, options);
      }
    } catch (error) {
      const rejected = error.response?.error_code >= 400 && error.response?.error_code < 500;
      const detail = rejected ? "Telegram menolak balasan. Periksa pesan tujuan atau format lampiran."
        : "Pengiriman belum dapat dikonfirmasi. Periksa grup Telegram sebelum mengirim ulang.";
      throw Object.assign(new Error(detail), { statusCode: 502 });
    }

    try {
      await conversationRepository.recordReply({
        parent: { order_id: orderId, reply_to_message_id: target.message_id },
        chatId, threadId, message, sender: currentTarget.owner_name,
        content: content || null, outbound: true,
        excerpt: (target.content || target.file_name || "Lampiran Telegram").slice(0, 300),
        media: replyMedia(message),
      });
      return { replies: await conversationRepository.list(orderId) };
    } catch (error) {
      console.error("Balasan terkirim tetapi riwayat Telegram gagal dimuat:", telegramErrorMessage(error));
      return { warning: "Balasan terkirim ke Telegram, tetapi riwayat belum dapat diperbarui." };
    }
  }));
}

async function ingestOrderReply(ctx) {
  const message = ctx.message;
  if (!isGroupChat(ctx.chat) || (message.from?.is_bot && !message.sender_chat)) return false;
  const reply = message.reply_to_message;
  if (!reply?.message_id && !message.media_group_id) return false;
  const media = replyMedia(message);
  const content = (message.text || message.caption || "").trim();
  if (!content && !media) return false;

  const chatId = ctx.chat.id;
  const threadId = getThreadId(message);
  const group = await telegramRepository.getGroupByChatThread(chatId, threadId);
  if (!group?.is_active || !["PENGAWALAN", "LOGIC"].includes(group.category)) return false;

  const lookup = {
    groupId: group.id, chatId, threadId,
    replyId: reply?.message_id, albumId: message.media_group_id,
  };
  let parent = await conversationRepository.findParent(lookup);
  // Telegram can deliver a user's reply before our send response has been recorded.
  // Wait only for that active send; new orders use their own incoming queue.
  const receipt = reply && outgoingReceipts.get(`${chatId}:${threadId || 0}`);
  if (!parent && receipt) {
    await receipt.catch(() => {});
    parent = await conversationRepository.findParent(lookup);
  }
  const sender = message.sender_chat?.title || [message.from?.first_name, message.from?.last_name].filter(Boolean).join(" ")
    || message.from?.username || "Pengirim Telegram";
  const entry = { chatId, threadId, message, sender: sender.slice(0, 255), content: content || null, media };
  const albumKey = message.media_group_id && `${chatId}:${threadId}:${message.media_group_id}`;
  const pending = albumKey ? pendingReplyAlbums.get(albumKey) : null;
  const album = pending && pending.expiresAt > Date.now() ? pending : null;
  if (!parent) {
    // An album member without a reply can arrive before the member that carries it.
    if (albumKey && !reply && media) {
      const buffer = album || { entries: new Map(), expiresAt: Date.now() + REPLY_ALBUM_WINDOW_MS };
      if (buffer.entries.size < 10) buffer.entries.set(message.message_id, entry);
      pendingReplyAlbums.set(albumKey, buffer);
      if (pendingReplyAlbums.size > MAX_PENDING_REPLY_ALBUMS) {
        pendingReplyAlbums.delete(pendingReplyAlbums.keys().next().value);
      }
    }
    return false;
  }

  const excerpt = (message.quote?.text || reply?.text || reply?.caption
    || parent.reply_excerpt || "Lampiran Telegram").trim().slice(0, 300);
  await conversationRepository.recordReply({ ...entry, parent, excerpt });
  for (const sibling of album?.entries.values() || []) {
    await conversationRepository.recordReply({ ...sibling, parent, excerpt });
  }
  if (albumKey) pendingReplyAlbums.delete(albumKey);
  realtimeService.emitOrdersChanged();
  return true;
}

async function handleOrderMessage(ctx, ingest, replyOnly = false) {
  if (!isGroupChat(ctx.chat)) return;
  const receivedAt = Date.now();
  const text = ctx.message?.text || ctx.message?.caption || "";
  const orderMessage = Boolean(parseIncomingOrder(text.trim()) || parseConfigOrder(text.trim()));
  try {
    const queues = replyOnly ? replyMessageQueues : orderMessageQueues;
    await queueTelegramWork(queues, ctx.chat.id, getThreadId(ctx.message), async () => {
      const startedAt = Date.now();
      for (let attempt = 0; ; attempt += 1) {
        try {
          await ingest();
          break;
        } catch (error) {
          const retryDelay = INCOMING_DATABASE_RETRY_DELAYS[attempt];
          if (!TRANSIENT_DATABASE_ERRORS.has(error.code) || retryDelay === undefined) throw error;
          console.warn("Mengulang pencatatan pesan Telegram", {
            chat_id: ctx.chat.id, message_id: ctx.message.message_id, code: error.code, retry: attempt + 1,
          });
          await delay(retryDelay);
        }
      }
      if (orderMessage) {
        const metrics = {
          at: new Date().toISOString(), chat_id: ctx.chat.id, message_id: ctx.message.message_id,
          ...ctx.orderMetrics,
          telegram_delay_ms: ctx.message.date ? Math.max(0, receivedAt - ctx.message.date * 1000) : null,
          queue_ms: startedAt - receivedAt, processing_ms: Date.now() - startedAt,
        };
        console.log(`Order Telegram diproses ${JSON.stringify(metrics)}`);
      }
    });
  } catch (error) {
    console.error("Pesan order Telegram gagal diproses:", {
      chat_id: ctx.chat.id, message_id: ctx.message?.message_id,
      code: error.code, error: telegramErrorMessage(error), at: new Date().toISOString(),
    });
  }
}

async function ensureAdmin(ctx) {
  if (!isGroupChat(ctx.chat)) {
    await ctx.reply("Perintah ini hanya dapat dijalankan di dalam grup Telegram.");
    return false;
  }
  if (!(await isGroupAdmin(ctx.chat.id, ctx.from.id))) {
    await ctx.reply("Hanya admin grup yang dapat menjalankan /setgrup.");
    return false;
  }
  return true;
}

async function handleSetGroup(ctx) {
  if (!(await ensureAdmin(ctx))) return;
  const cities = await telegramRepository.getCities();
  await ctx.reply("Konfigurasi grup order\n\n1/4 — Pilih kota:", {
    ...threadOptions(ctx.message),
    ...cityKeyboard(cities),
  });
}

async function renderDatinInstitutionChoices(ctx, page = 0, edit = false) {
  const data = await telegramRepository.getDatinInstitutions(page, DATIN_INSTITUTIONS_PER_PAGE);
  const selectedIds = await telegramRepository.getDatinSubscriptionIds(ctx.from.id);
  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const message = [
    "Pilih instansi DATIN untuk alarm pribadi.",
    "Alarm grup tetap menerima seluruh DATIN; pilihan ini hanya untuk chat pribadi.",
    "",
    `Halaman ${data.page + 1}/${totalPages} · Dipilih: ${selectedIds.length}`,
  ].join("\n");
  const options = datinInstitutionKeyboard({ ...data, selectedIds });
  if (edit) await ctx.editMessageText(message, options);
  else await ctx.reply(message, options);
}

async function handleAlarmRegistration(ctx, customerType) {
  if (!isGroupChat(ctx.chat)) {
    if (ctx.chat?.type !== "private") {
      await ctx.reply("Perintah alarm hanya dapat digunakan di chat pribadi atau grup Telegram.");
      return;
    }

    await telegramRepository.saveAlarmSubscriber({
      customerType,
      userId: ctx.from.id,
      chatId: ctx.chat.id,
      username: ctx.from.username,
      displayName: [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" "),
    });
    if (customerType === "datin") {
      await renderDatinInstitutionChoices(ctx);
      return;
    }
    await ctx.reply(`✅ Alarm ONT down ${customerType.toUpperCase()} aktif untuk akun ini.`);
    return;
  }

  if (!(await ensureAdmin(ctx))) return;

  const category = telegramRepository.getAlarmCategory(customerType);
  await telegramRepository.saveAlarmGroup({
    chatId: ctx.chat.id,
    threadId: getThreadId(ctx.message),
    name: groupName(ctx.chat, getThreadId(ctx.message)),
    category,
  });

  await ctx.reply(
    `✅ Grup alarm ${customerType.toUpperCase()} berhasil didaftarkan.`,
    threadOptions(ctx.message),
  );
}

async function handleAlarmUnsubscribe(ctx, customerType) {
  if (ctx.chat?.type !== "private") {
    await ctx.reply("Perintah ini hanya dapat digunakan di chat pribadi dengan bot.");
    return;
  }

  await telegramRepository.deactivateAlarmSubscriber(customerType, ctx.from.id);
  if (customerType === "datin") await telegramRepository.clearDatinSubscriptions(ctx.from.id);
  await ctx.reply(`✅ Alarm ${customerType.toUpperCase()} dinonaktifkan untuk akun ini.`);
}

async function handleAlarmStatus(ctx) {
  if (ctx.chat?.type !== "private") {
    await ctx.reply("Perintah ini hanya dapat digunakan di chat pribadi dengan bot.");
    return;
  }

  const subscriptions = await telegramRepository.getAlarmSubscriptions(ctx.from.id);
  if (!subscriptions.length) {
    await ctx.reply("Belum ada alarm personal yang aktif. Gunakan /alarmdatin atau /alarmnodeb.");
    return;
  }

  const rows = [`🔔 Alarm personal aktif: ${subscriptions.map((item) => item.customer_type.toUpperCase()).join(", ")}.`];
  if (subscriptions.some((item) => item.customer_type === "datin")) {
    const institutions = await telegramRepository.getDatinSubscriptionNames(ctx.from.id);
    rows.push(institutions.length ? `DATIN: ${institutions.join(", ")}` : "DATIN: belum ada instansi dipilih.");
  }
  await ctx.reply(rows.join("\n\n"));
}

async function ensurePrivateAlarmCallback(ctx) {
  if (ctx.callbackQuery?.message?.chat?.type === "private") return true;
  await ctx.answerCbQuery("Pengaturan alarm pribadi hanya tersedia di chat bot.", { show_alert: true });
  return false;
}

async function ensureCallbackAdmin(ctx) {
  const message = ctx.callbackQuery?.message;
  if (!message || !isGroupChat(message.chat)) return false;
  if (await isGroupAdmin(message.chat.id, ctx.from.id)) return true;
  await ctx.answerCbQuery("Hanya admin grup yang dapat mengubah konfigurasi.", { show_alert: true });
  return false;
}

async function configureGroup(ctx, cityId, segmentId, category, workflow) {
  const message = ctx.callbackQuery.message;
  const threadId = getThreadId(message);
  await telegramRepository.saveGroup({ chatId: message.chat.id, threadId, name: groupName(message.chat, threadId), cityId, segmentId, category, workflow });
  const cities = await telegramRepository.getCities();
  const segments = await telegramRepository.getSegments();
  const city = cities.find((item) => Number(item.id) === Number(cityId));
  const segment = segments.find((item) => Number(item.id) === Number(segmentId));
  await ctx.editMessageText(["✅ Grup berhasil dikonfigurasi", `Kota: ${city?.name || cityId}`, `Segmen: ${segment?.code === "REPLACE_ONT" ? "Replace ONT" : segment?.code || segmentId}`, `Alur kerja: ${workflow === "ASSURANCE" ? "Assurance" : "Provisioning"}`, `Jenis: ${category === "PENGAWALAN" ? "Pengawalan" : "Logic"}`, `Grup: ${groupName(message.chat, threadId)}`].join("\n"));
}

function registerHandlers() {
  bot.use((ctx, next) => {
    limitTelegramRequests(ctx.telegram);
    return next();
  });
  bot.command("setgrup", async (ctx) => { try { await handleSetGroup(ctx); } catch (error) { console.error("/setgrup gagal:", telegramErrorMessage(error)); } });
  bot.command("help", async (ctx) => { try { await ctx.reply(helpMessage(), threadOptions(ctx.message)); } catch (error) { console.error("/help gagal:", telegramErrorMessage(error)); } });
  if (CACTI_ENABLED) {
    bot.command("alarmnodeb", async (ctx) => { try { await handleAlarmRegistration(ctx, "nodeb"); } catch (error) { console.error("/alarmnodeb gagal:", telegramErrorMessage(error)); await ctx.reply(`⚠️ ${telegramErrorMessage(error)}`, threadOptions(ctx.message)); } });
    bot.command("alarmdatin", async (ctx) => { try { await handleAlarmRegistration(ctx, "datin"); } catch (error) { console.error("/alarmdatin gagal:", telegramErrorMessage(error)); await ctx.reply(`⚠️ ${telegramErrorMessage(error)}`, threadOptions(ctx.message)); } });
    bot.command("stopalarmnodeb", async (ctx) => { try { await handleAlarmUnsubscribe(ctx, "nodeb"); } catch (error) { console.error("/stopalarmnodeb gagal:", telegramErrorMessage(error)); await ctx.reply(`⚠️ ${telegramErrorMessage(error)}`); } });
    bot.command("stopalarmdatin", async (ctx) => { try { await handleAlarmUnsubscribe(ctx, "datin"); } catch (error) { console.error("/stopalarmdatin gagal:", telegramErrorMessage(error)); await ctx.reply(`⚠️ ${telegramErrorMessage(error)}`); } });
    bot.command("alarmstatus", async (ctx) => { try { await handleAlarmStatus(ctx); } catch (error) { console.error("/alarmstatus gagal:", telegramErrorMessage(error)); await ctx.reply(`⚠️ ${telegramErrorMessage(error)}`); } });
  }
  bot.command("config", (ctx) => handleOrderMessage(ctx, () => ingestConfigOrder(ctx)));
  bot.on("text", (ctx) => {
    const order = Boolean(parseIncomingOrder(ctx.message.text.trim()));
    return handleOrderMessage(ctx, () => order ? ingestIncomingOrder(ctx) : ingestOrderReply(ctx), !order);
  });
  bot.on("photo", (ctx) => {
    const caption = ctx.message.caption?.trim() || "";
    const order = Boolean(parseIncomingOrder(caption) || parseConfigOrder(caption));
    return handleOrderMessage(ctx, async () => {
      if (order || !(await ingestOrderReply(ctx))) await ingestPhotoOrder(ctx);
    }, !order);
  });
  bot.on("message", (ctx) => handleOrderMessage(ctx, () => ingestOrderReply(ctx), true));
  bot.action(/^setgroup:city:(\d+)$/, async (ctx) => { if (!(await ensureCallbackAdmin(ctx))) return; const segments = await telegramRepository.getSegments(); await ctx.editMessageText("Konfigurasi grup order\n\n2/4 — Pilih segmen:", segmentKeyboard(ctx.match[1], segments)); await ctx.answerCbQuery(); });
  bot.action(/^setgroup:segment:(\d+):(\d+)$/, async (ctx) => { if (!(await ensureCallbackAdmin(ctx))) return; await ctx.editMessageText("Konfigurasi grup order\n\n3/4 — Pilih alur kerja:", workflowKeyboard(ctx.match[1], ctx.match[2])); await ctx.answerCbQuery(); });
  bot.action(/^setgroup:flow:(\d+):(\d+):([AP])$/, async (ctx) => { if (!(await ensureCallbackAdmin(ctx))) return; await ctx.editMessageText("Konfigurasi grup order\n\n4/4 — Pilih jenis grup:", categoryKeyboard(ctx.match[1], ctx.match[2], ctx.match[3])); await ctx.answerCbQuery(); });
  bot.action(/^setgroup:type:(\d+):(\d+):([AP]):(PENGAWALAN|LOGIC)$/, async (ctx) => {
    if (!(await ensureCallbackAdmin(ctx))) return;
    try {
      await configureGroup(ctx, ctx.match[1], ctx.match[2], ctx.match[4], ctx.match[3] === "A" ? "ASSURANCE" : "PROVISIONING");
      await ctx.answerCbQuery();
    } catch (error) {
      console.error("Konfigurasi grup Telegram gagal:", telegramErrorMessage(error));
      await ctx.answerCbQuery("Gagal menyimpan konfigurasi. Periksa pengaturan grup dan coba lagi.", { show_alert: true });
    }
  });
  // Old inline keyboards cannot save a group without a workflow.
  bot.action(/^setgroup:category:(\d+):(\d+):(PENGAWALAN|LOGIC)$/, async (ctx) => { if (!(await ensureCallbackAdmin(ctx))) return; await ctx.editMessageText("Konfigurasi grup order\n\n3/4 — Pilih alur kerja:", workflowKeyboard(ctx.match[1], ctx.match[2])); await ctx.answerCbQuery(); });
  bot.action("setgroup:cancel", async (ctx) => { if (!(await ensureCallbackAdmin(ctx))) return; await ctx.editMessageText("Konfigurasi grup dibatalkan."); await ctx.answerCbQuery(); });
  if (CACTI_ENABLED) {
    bot.action(/^alarmdatin:page:(\d+)$/, async (ctx) => { try { if (!(await ensurePrivateAlarmCallback(ctx))) return; await renderDatinInstitutionChoices(ctx, Number(ctx.match[1]), true); await ctx.answerCbQuery(); } catch (error) { console.error("Halaman /alarmdatin gagal:", telegramErrorMessage(error)); await ctx.answerCbQuery("Gagal memuat pilihan.", { show_alert: true }); } });
    bot.action(/^alarmdatin:toggle:(\d+):(\d+)$/, async (ctx) => { try { if (!(await ensurePrivateAlarmCallback(ctx))) return; const selected = await telegramRepository.toggleDatinSubscription(ctx.from.id, Number(ctx.match[1])); await renderDatinInstitutionChoices(ctx, Number(ctx.match[2]), true); await ctx.answerCbQuery(selected === null ? "Daftar instansi berubah. Pilih dari daftar terbaru." : undefined); } catch (error) { console.error("Pilihan /alarmdatin gagal:", telegramErrorMessage(error)); await ctx.answerCbQuery("Gagal menyimpan pilihan.", { show_alert: true }); } });
    bot.action(/^alarmdatin:clear:(\d+)$/, async (ctx) => { try { if (!(await ensurePrivateAlarmCallback(ctx))) return; await telegramRepository.clearDatinSubscriptions(ctx.from.id); await renderDatinInstitutionChoices(ctx, Number(ctx.match[1]), true); await ctx.answerCbQuery("Pilihan dikosongkan."); } catch (error) { console.error("Kosongkan /alarmdatin gagal:", telegramErrorMessage(error)); await ctx.answerCbQuery("Gagal mengosongkan pilihan.", { show_alert: true }); } });
    bot.action("alarmdatin:done", async (ctx) => { try { if (!(await ensurePrivateAlarmCallback(ctx))) return; const institutions = await telegramRepository.getDatinSubscriptionNames(ctx.from.id); await ctx.editMessageText(institutions.length ? `✅ Alarm DATIN aktif untuk ${institutions.length} instansi. Gunakan /alarmdatin untuk mengubah pilihan.` : "Belum ada instansi dipilih. Gunakan /alarmdatin untuk memilih."); await ctx.answerCbQuery(); } catch (error) { console.error("Simpan /alarmdatin gagal:", telegramErrorMessage(error)); await ctx.answerCbQuery("Gagal menyimpan pilihan.", { show_alert: true }); } });
  }
  bot.catch((error) => console.error("Telegraf error:", telegramErrorMessage(error)));
}

async function notifyOrderClaim(claim) {
  if (!bot || !claim.telegram_chat_id || !claim.telegram_message_id) return;
  try {
    await queueOutgoingMessage(claim.telegram_chat_id, claim.telegram_thread_id, async () => {
      await trackOutgoingReceipt(claim.telegram_chat_id, claim.telegram_thread_id, async () => {
        const message = await bot.telegram.sendMessage(claim.telegram_chat_id, `🟡 On progress oleh ${claim.user_name}`, {
          ...(claim.telegram_thread_id ? { message_thread_id: claim.telegram_thread_id } : {}),
          reply_to_message_id: claim.telegram_message_id,
        });
        await rememberOutgoing(claim.order_id, claim.telegram_chat_id, claim.telegram_thread_id, [message.message_id], "claim");
      });
    });
  }
  catch (error) { console.error("Notifikasi claim Telegram gagal:", telegramErrorMessage(error)); }
}

async function rememberOutgoing(orderId, chatId, threadId, messageIds, kind) {
  if (!orderId || !messageIds.length) return;
  try {
    await conversationRepository.recordOutgoing({ orderId, chatId, threadId, messageIds, kind });
  } catch (error) {
    console.error("ID pesan Telegram tidak dapat dicatat:", telegramErrorMessage(error));
  }
}

async function sendRecordedResult(notification, send) {
  return trackOutgoingReceipt(notification.chat_id, notification.thread_id, async () => {
    const result = await send();
    const messages = Array.isArray(result) ? result : [result];
    await rememberOutgoing(notification.order_id, notification.chat_id, notification.thread_id,
      messages.map((message) => message.message_id), "result");
    return result;
  });
}

function replyOptions(notification) {
  return {
    ...(notification.thread_id ? { message_thread_id: notification.thread_id } : {}),
    ...(notification.message_id ? { reply_to_message_id: notification.message_id } : {}),
  };
}

async function sendResultFiles(notification, options, caption) {
  const deliveries = [];
  const errors = [];

  const files = notification.files || [];
  // Telegram albums accept 2–10 photos, or 2–10 documents of the same kind.
  const allPhotos = files.every((file) => file.mime_type?.startsWith("image/"));
  const allDocuments = files.every((file) => !file.mime_type?.startsWith("image/"));
  if (files.length >= 2 && files.length <= 10 && files.every((file) => file.local_path) && (allPhotos || allDocuments)) {
    try {
      const messages = await sendRecordedResult(notification, () => bot.telegram.sendMediaGroup(notification.chat_id, files.map((file, index) => ({
        type: allPhotos ? "photo" : "document",
        media: { source: file.local_path, filename: file.file_name },
        ...(index === 0 && caption ? { caption } : {}),
      })), options));
      return { deliveries: messages.map((message) => message.message_id), errors };
    } catch (error) {
      // Do not retry as separate messages: an ambiguous API failure could duplicate an album.
      console.error("Pengiriman album Telegram gagal:", telegramErrorMessage(error));
      return { deliveries, errors: [telegramErrorMessage(error)] };
    }
  }

  for (const [index, file] of files.entries()) {
    if (!file.local_path) {
      errors.push(`${file.file_name || "Lampiran"}: file lokal tidak ditemukan`);
      continue;
    }

    try {
      const filePayload = { source: file.local_path, filename: file.file_name };
      const fileOptions = { ...options, ...(index === 0 && caption ? { caption } : {}) };
      const message = await sendRecordedResult(notification, () => file.mime_type?.startsWith("image/")
        ? bot.telegram.sendPhoto(notification.chat_id, filePayload, fileOptions)
        : bot.telegram.sendDocument(notification.chat_id, filePayload, fileOptions));
      deliveries.push(message.message_id);
    } catch (error) {
      console.error("Pengiriman lampiran Telegram gagal:", telegramErrorMessage(error));
      errors.push(`${file.file_name || "Lampiran"}: ${telegramErrorMessage(error)}`);
    }
  }

  return { deliveries, errors };
}

async function notifyOrderResult(notification) {
  if (!bot || !notification?.chat_id) {
    return { delivered: false, message_id: null, error: "Bot atau tujuan Telegram tidak tersedia" };
  }
  return queueOutgoingMessage(notification.chat_id, notification.thread_id, () => deliverOrderResult(notification));
}

async function deliverOrderResult(notification) {
  const options = replyOptions(notification);
  const deliveries = [];
  const errors = [];
  const content = notification.content?.trim();
  const hasFiles = notification.files?.length > 0;
  const useCaption = hasFiles && content && content.length <= 1024;

  if (content && !useCaption) try {
    const message = await sendRecordedResult(notification, () => bot.telegram.sendMessage(
      notification.chat_id,
      content,
      options,
    ));
    deliveries.push(message.message_id);
  } catch (error) {
    console.error("Pengiriman result Telegram gagal:", telegramErrorMessage(error));
    errors.push(telegramErrorMessage(error));
  }

  const fileDelivery = await sendResultFiles(notification, options, useCaption ? content : undefined);
  deliveries.push(...fileDelivery.deliveries);
  errors.push(...fileDelivery.errors);

  return {
    delivered: deliveries.length > 0 && errors.length === 0,
    partially_delivered: deliveries.length > 0 && errors.length > 0,
    message_id: deliveries[0] || null,
    error: errors.length ? errors.join("; ") : null,
  };
}

async function sendMessage(chatId, text, threadId = 0) {
  if (!CACTI_ENABLED) return { delivered: false, skipped: true, error: "Cacti dinonaktifkan" };
  if (!bot || !chatId) {
    return { delivered: false, error: "Bot atau tujuan Telegram tidak tersedia" };
  }

  try {
    const message = await bot.telegram.sendMessage(
      chatId,
      text,
      threadId ? { message_thread_id: threadId } : {},
    );
    return { delivered: true, message_id: message.message_id, error: null };
  } catch (error) {
    console.error("Pengiriman alarm Cacti ke Telegram gagal:", telegramErrorMessage(error));
    return {
      delivered: false,
      error: telegramErrorMessage(error),
      error_code: error.response?.error_code || null,
      retry_after: error.response?.parameters?.retry_after || null,
    };
  }
}

async function sendPersonalAlarmMessage(chatId, text) {
  if (!CACTI_ENABLED) return { delivered: false, skipped: true, error: "Cacti dinonaktifkan" };
  const run = async () => {
    let lastDelivery = null;

    for (let attempt = 0; attempt <= PERSONAL_ALARM_RETRY_LIMIT; attempt += 1) {
      const delay = Math.max(0, nextPersonalAlarmAt - Date.now());
      if (delay) await wait(delay);
      nextPersonalAlarmAt = Date.now() + PERSONAL_ALARM_INTERVAL_MS;

      const delivery = await sendMessage(chatId, text);
      if (delivery.delivered || delivery.error_code === 403 || delivery.error_code === 400) {
        return delivery;
      }

      lastDelivery = delivery;
      if (delivery.error_code === 429) {
        const retryAfterMs = Math.max(1, Number(delivery.retry_after) || 1) * 1000;
        nextPersonalAlarmAt = Math.max(nextPersonalAlarmAt, Date.now() + retryAfterMs);
        continue;
      }

      if (attempt < PERSONAL_ALARM_RETRY_LIMIT) {
        const backoffMs = 1000 * (attempt + 1);
        nextPersonalAlarmAt = Math.max(nextPersonalAlarmAt, Date.now() + backoffMs);
      }
    }

    return lastDelivery || { delivered: false, error: "Pengiriman alarm personal gagal" };
  };

  personalAlarmQueue = personalAlarmQueue.catch(() => undefined).then(run);
  return personalAlarmQueue;
}

async function runPolling(signal) {
  for (let attempt = 0; !signal.aborted; attempt += 1) {
    try {
      const startupRequest = () => ({
        signal: AbortSignal.any([signal, AbortSignal.timeout(POLLING_REQUEST_TIMEOUT_MS)]),
      });
      bot.botInfo ??= await bot.telegram.callApi("getMe", {}, startupRequest());
      signal.throwIfAborted();
      await bot.telegram.callApi("deleteWebhook", {}, startupRequest());
      signal.throwIfAborted();

      // Telegraf 4's launch couples network setup and the long-lived polling loop.
      // Start that same loop after the abortable setup to avoid starting during shutdown.
      const polling = bot.startPolling();
      pollingActive = true;
      console.log(`🤖 Polling Telegram dimulai (timeout ${TELEGRAM_POLL_SECONDS} detik)`);
      try {
        await polling;
      } finally {
        pollingActive = false;
      }
      return;
    } catch (error) {
      if (signal.aborted) return;
      const code = error.code;
      const timeoutConflict = code === 409 && lastPollingTimeoutAt > 0
        && Date.now() - lastPollingTimeoutAt < 120000;
      if (code === 409 && !timeoutConflict) {
        console.error("Polling Telegram dihentikan karena konflik 409. Periksa proses lain yang memakai token bot yang sama.", error.description || error.response?.description || "");
        return;
      }

      const retryDelay = POLLING_RETRY_DELAYS[attempt];
      const temporary = ["FetchError", "AbortError", "TimeoutError"].includes(error.name)
        || timeoutConflict || code === 429 || (typeof code === "number" && code >= 500);
      if (!temporary || retryDelay === undefined) {
        console.error(`Polling Telegram gagal setelah ${attempt + 1} percobaan: ${telegramErrorMessage(error)}`);
        return;
      }

      const retryAfter = code === 429 ? Number(error.parameters?.retry_after) * 1000 || 0 : 0;
      const conflictCooldown = timeoutConflict ? (TELEGRAM_POLL_SECONDS + 5) * 1000 : 0;
      const waitMs = Math.max(retryDelay, retryAfter, conflictCooldown);
      console.warn(`Polling Telegram gagal: ${telegramErrorMessage(error)}. Retry ${attempt + 1}/${POLLING_RETRY_DELAYS.length} dalam ${waitMs / 1000} detik.`);
      await delay(waitMs, undefined, { signal }).catch((error) => {
        if (!signal.aborted) throw error;
      });
    }
  }
}

function startPolling() {
  if (!bot || pollingTask) return pollingTask;
  if (!handlersRegistered) {
    registerHandlers();
    handlersRegistered = true;
  }
  pollingController = new AbortController();
  pollingTask = runPolling(pollingController.signal).finally(() => {
    pollingTask = undefined;
    pollingController = undefined;
  });
  return pollingTask;
}

function stopPolling(reason) {
  if (!pollingController || pollingController.signal.aborted) return pollingTask;
  pollingController.abort();
  if (pollingActive) bot.stop(reason);
  return pollingTask;
}


module.exports = {
  getSourcePhoto,
  getConversationMedia,
  sendConversationReply,
  startPolling,
  stopPolling,
  notifyOrderClaim,
  notifyOrderResult,
  sendMessage,
  sendPersonalAlarmMessage,
};
