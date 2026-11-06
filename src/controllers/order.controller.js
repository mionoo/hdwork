const orderService = require("../services/order.service");
const telegramService = require("../services/telegram.service");
const realtimeService = require("../services/realtime.service");
const orderSourceRepository = require("../repositories/order-source.repository");
const conversationRepository = require("../repositories/order-conversation.repository");

const conversationMediaTypes = {
  photo: "image/jpeg", video: "video/mp4", video_note: "video/mp4", animation: "video/mp4",
  voice: "audio/ogg", audio: "audio/mpeg", sticker: "image/webp", sticker_video: "video/webm",
};
const playableAudioTypes = new Set(["audio/mpeg", "audio/mp4", "audio/ogg", "audio/wav", "audio/webm"]);

async function getConversationMedia(req, res) {
  try {
    const { id, messageId } = req.params;
    if (!/^\d+$/.test(messageId)) return res.status(400).json({ success: false, message: "ID pesan tidak valid" });
    await orderService.getOrderById(id, req.user);
    const media = await conversationRepository.findMedia(id, messageId);
    if (!media) return res.status(404).json({ success: false, message: "Lampiran tidak ditemukan" });

    const filename = await telegramService.getConversationMedia(media);
    const type = playableAudioTypes.has(media.mime_type) && ["audio", "voice"].includes(media.media_kind)
      ? media.mime_type : conversationMediaTypes[media.media_kind];
    res.set({ "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
    if (!type) res.attachment(media.file_name || "lampiran-telegram");
    res.type(type || "application/octet-stream");
    res.sendFile(filename);
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, message: error.statusCode ? error.message : "Lampiran gagal dimuat" });
  }
}

async function getSourcePhoto(req, res) {
  try {
    if (!/^\d+$/.test(req.params.photoId)) return res.status(400).json({ success: false, message: "ID foto tidak valid" });
    await orderService.getOrderById(req.params.id, req.user);
    const photo = await orderSourceRepository.find(req.params.id, req.params.photoId);
    if (!photo) return res.status(404).json({ success: false, message: "Foto tidak ditemukan" });
    const filename = await telegramService.getSourcePhoto(photo);
    res.set("Cache-Control", "private, no-store");
    res.type("image/jpeg");
    res.sendFile(filename);
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message || "Foto tidak dapat dimuat" });
  }
}

async function getAllOrders(req, res) {
  try {
    const {
      status,
      city_id,
      segment_id,
      user_id,
      telegram_group_id,
      telegram_group_ids,
    } = req.query;

    const currentUser = req.user;

    const filters = {
      status,
      city_id,
      segment_id,
      user_id,
      telegram_group_id,
      telegram_group_ids,
    };

    const orders = await orderService.getAllOrders(
      filters,
      currentUser,
    );

    return res.status(200).json({
      success: true,
      total: orders.length,
      data: orders,
    });
  } catch (error) {
    console.error(error);

    return res.status(error.statusCode || 500).json({
      success: false,
      message:
        error.message || "Gagal mengambil data order",
    });
  }
}

async function getOrderById(req, res) {
  try {
    const { id } = req.params;
    const currentUser = req.user;

    const order = await orderService.getOrderById(
      id,
      currentUser,
    );

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order tidak ditemukan",
      });
    }

    return res.status(200).json({
      success: true,
      data: { ...order, telegram_conversation: await conversationRepository.list(order.id) },
    });
  } catch (error) {
    console.error(error);

    return res.status(error.statusCode || 500).json({
      success: false,
      message:
        error.message || "Gagal mengambil detail order",
    });
  }
}

async function claimOrder(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const result = await orderService.claimOrder(id, userId);

    telegramService.notifyOrderClaim(result);
    realtimeService.emitOrdersChanged();

    return res.status(200).json({
      success: true,
      message: "Order berhasil di-claim",
      data: result,
    });
  } catch (error) {
    console.error(error);

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Gagal claim order",
    });
  }
}

async function reassignOrder(req, res) {
  try {
    const { id } = req.params;

    const actorUserId = req.user.id;

    const { target_user_id: targetUserId, reason } = req.body;

    if (!targetUserId || !reason) {
      return res.status(400).json({
        success: false,
        message: "target_user_id dan reason wajib diisi",
      });
    }

    const result = await orderService.reassignOrder(
      id,
      actorUserId,
      targetUserId,
      reason,
    );
    realtimeService.emitOrdersChanged();

    return res.status(200).json({
      success: true,
      message: "Order berhasil di-reassign",
      data: result,
    });
  } catch (error) {
    console.error(error);

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Gagal reassign order",
    });
  }
}

async function getReassignTargets(req, res) {
  try {
    const { id } = req.params;

    const targets = await orderService.getReassignTargets(
      id,
      req.user,
    );

    return res.status(200).json({
      success: true,
      data: targets,
    });
  } catch (error) {
    console.error(error);

    return res.status(error.statusCode || 500).json({
      success: false,
      message:
        error.message || "Gagal mengambil daftar HD tujuan",
    });
  }
}

async function escalateOrder(req, res) {
  try {
    const { id } = req.params;

    const actorUserId = req.user.id;

    const { reason } = req.body;

    if (!reason) {
      return res.status(400).json({
        success: false,
        message: "reason wajib diisi",
      });
    }

    const result = await orderService.escalateOrder(id, actorUserId, reason);
    realtimeService.emitOrdersChanged();

    return res.status(200).json({
      success: true,
      message: "Order berhasil di-escalate",
      data: result,
    });
  } catch (error) {
    console.error(error);

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Gagal escalate order",
    });
  }
}

async function sendResult(req, res) {
  try {
    const { id } = req.params;

    const userId = req.user.id;

    const {
      content,
      telegram_chat_id,
      telegram_message_id,
    } = req.body;

    const files = (req.files || []).map((file) => ({
      file_name: file.originalname,
      file_url: `${req.protocol}://${req.get("host")}/uploads/results/${file.filename}`,
      local_path: file.path,
      mime_type: file.mimetype,
      file_size: file.size,
    }));

    if (!content && files.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Result harus memiliki content atau file",
      });
    }

    const result = await orderService.sendResult(
      id,
      userId,
      content,
      telegram_chat_id ?? null,
      telegram_message_id ?? null,
      files,
    );
    const telegramDelivery = await telegramService.notifyOrderResult({ ...result.telegram, order_id: id });
    if (telegramDelivery.message_id) {
      try {
        await orderService.markResultTelegramDelivery(
          result.result_id,
          result.telegram.chat_id,
          telegramDelivery.message_id,
          result.telegram.thread_id,
        );
      } catch (error) {
        console.error("Pencatatan pengiriman Telegram result gagal:", error.message);
      }
    }
    realtimeService.emitOrdersChanged();

    return res.status(201).json({
      success: true,
      message: telegramDelivery.delivered
        ? "Result berhasil dikirim ke sistem dan Telegram"
        : "Result tersimpan di sistem; pengiriman Telegram perlu diperiksa",
      data: { ...result, telegram_delivery: telegramDelivery },
    });
  } catch (error) {
    console.error(error);

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Gagal mengirim result",
    });
  }
}

async function completeOrder(req, res) {
  try {
    const { id } = req.params;

    const userId = req.user.id;

    const files = (req.files || []).map((file) => ({
      file_name: file.originalname,
      file_url: `${req.protocol}://${req.get("host")}/uploads/results/${file.filename}`,
      local_path: file.path,
      mime_type: file.mimetype,
      file_size: file.size,
    }));

    const result = await orderService.completeOrder(id, userId, {
      content: req.body.content || null,
      files,
    });
    let resultDelivery = null;
    if (result.telegram.result) {
      const content = result.telegram.result.content?.trim();
      const completedBy = result.telegram.user_name?.trim();
      resultDelivery = await telegramService.notifyOrderResult({
        ...result.telegram,
        ...result.telegram.result,
        order_id: id,
        content: [content, completedBy && `oleh ${completedBy}`].filter(Boolean).join("\n\n"),
      });
      if (resultDelivery.message_id) {
        try {
          await orderService.markResultTelegramDelivery(
            result.telegram.result.result_id,
            result.telegram.chat_id,
            resultDelivery.message_id,
            result.telegram.thread_id,
          );
        } catch (error) {
          console.error("Pencatatan pengiriman Telegram result gagal:", error.message);
        }
      }
    }
    // Results already sent earlier are not repeated when completing an order.
    const completionDelivery = { delivered: false, skipped: true, error: null };
    const allTelegramDelivered = !resultDelivery || resultDelivery.delivered;
    realtimeService.emitOrdersChanged();

    return res.status(200).json({
      success: true,
      message: allTelegramDelivered
        ? (resultDelivery ? "Order berhasil diselesaikan dan hasil dikirim ke Telegram" : "Order berhasil diselesaikan")
        : "Order sudah diselesaikan; pengiriman Telegram perlu diperiksa",
      data: { ...result, telegram_delivery: { result: resultDelivery, completion: completionDelivery } },
    });
  } catch (error) {
    console.error(error);

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Gagal menyelesaikan order",
    });
  }
}

async function getOrderDetail(req, res) {
  try {
    const { id } = req.params;
    const currentUser = req.user;

    const result = await orderService.getOrderDetail(
      id,
      currentUser,
    );

    if (!result) {
      return res.status(404).json({
        success: false,
        message: "Order tidak ditemukan",
      });
    }

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error(error);

    return res.status(error.statusCode || 500).json({
      success: false,
      message:
        error.message || "Gagal mengambil detail order",
    });
  }
}

module.exports = {
  getSourcePhoto,
  getConversationMedia,
  getAllOrders,
  getOrderById,
  claimOrder,
  getReassignTargets,
  reassignOrder,
  escalateOrder,
  sendResult,
  completeOrder,
  getOrderDetail,
};
