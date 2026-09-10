const orderService = require("../services/order.service");
const telegramService = require("../services/telegram.service");
const realtimeService = require("../services/realtime.service");

async function getAllOrders(req, res) {
  try {
    const {
      status,
      city_id,
      segment_id,
      user_id,
    } = req.query;

    const currentUser = req.user;

    const filters = {
      status,
      city_id,
      segment_id,
      user_id,
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
      data: order,
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
      data: order,
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
    const telegramDelivery = await telegramService.notifyOrderResult(result.telegram);
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
      resultDelivery = await telegramService.notifyOrderResult({
        ...result.telegram,
        ...result.telegram.result,
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
    const completionDelivery = await telegramService.notifyOrderCompleted(result.telegram);
    const allTelegramDelivered = completionDelivery.delivered
      && (!resultDelivery || resultDelivery.delivered);
    realtimeService.emitOrdersChanged();

    return res.status(200).json({
      success: true,
      message: allTelegramDelivered
        ? "Order berhasil diselesaikan dan dikirim ke Telegram"
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
