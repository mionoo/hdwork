const orderRepository = require("../repositories/order.repository");

async function getAllOrders(filters, currentUser) {
  const scopedFilters = {
    ...filters,
  };

  if (currentUser.role === "HD") {
    scopedFilters.city_id = currentUser.city_id;

    const segmentIds =
      await orderRepository.getUserSegmentIds(
        currentUser.id,
      );

    scopedFilters.allowed_segment_ids = segmentIds;
  }

  if (currentUser.role === "ADMIN") {
    scopedFilters.city_id = currentUser.city_id;
  }

  return await orderRepository.getAllOrders(
    scopedFilters,
  );
}

async function getOrderById(id, currentUser) {
  const order =
    await orderRepository.getOrderById(id);

  if (!order) {
    const error = new Error("Order tidak ditemukan");
    error.statusCode = 404;
    throw error;
  }

  const allowed =
    await canAccessOrder(order, currentUser);

  if (!allowed) {
    const error = new Error(
      "Anda tidak memiliki akses ke order ini",
    );

    error.statusCode = 403;

    throw error;
  }

  return order;
}

async function claimOrder(orderId, userId) {
  return await orderRepository.claimOrder(
    orderId,
    userId,
  );
}

async function reassignOrder(
  orderId,
  actorUserId,
  targetUserId,
  reason,
) {
  return await orderRepository.reassignOrder(
    orderId,
    actorUserId,
    targetUserId,
    reason,
  );
}

async function getReassignTargets(orderId, currentUser) {
  const order = await getOrderById(orderId, currentUser);

  if (!order) {
    return null;
  }

  if (order.status !== "IN_PROGRESS") {
    const error = new Error("Order tidak dalam status IN_PROGRESS");
    error.statusCode = 409;
    throw error;
  }

  if (Number(order.performance_owner_id) !== Number(currentUser.id)) {
    const error = new Error("User bukan pemegang aktif order ini");
    error.statusCode = 403;
    throw error;
  }

  return await orderRepository.getReassignTargets(
    order.city_id,
    order.segment_id,
    currentUser.id,
  );
}

async function escalateOrder(
  orderId,
  actorUserId,
  reason,
) {
  return await orderRepository.escalateOrder(
    orderId,
    actorUserId,
    reason,
  );
}

async function sendResult(
  orderId,
  userId,
  content,
  telegramChatId,
  telegramMessageId,
  files,
) {
  return await orderRepository.sendResult(
    orderId,
    userId,
    content,
    telegramChatId,
    telegramMessageId,
    files,
  );
}

async function completeOrder(orderId, userId, completionResult) {
  return await orderRepository.completeOrder(
    orderId,
    userId,
    completionResult,
  );
}

async function markResultTelegramDelivery(resultId, chatId, messageId, threadId) {
  return await orderRepository.markResultTelegramDelivery(resultId, chatId, messageId, threadId);
}

async function getOrderDetail(
  orderId,
  currentUser,
) {
  const result =
    await orderRepository.getOrderDetail(orderId);

  if (!result) {
    return null;
  }

  const allowed =
    await canAccessOrder(
      result.order,
      currentUser,
    );

  if (!allowed) {
    const error = new Error(
      "Anda tidak memiliki akses ke order ini",
    );

    error.statusCode = 403;

    throw error;
  }

  return result;
}

// async function canAccessOrder(order, currentUser) {
//   if (!order) {
//     return false;
//   }

//   if (currentUser.role === "SUPER_ADMIN") {
//     return true;
//   }

//   if (currentUser.role === "ADMIN") {
//     return Number(order.city_id) === Number(currentUser.city_id);
//   }

//   if (currentUser.role === "HD") {
//     if (
//       Number(order.city_id) !== Number(currentUser.city_id)
//     ) {
//       return false;
//     }

//     const segmentIds =
//       await orderRepository.getUserSegmentIds(
//         currentUser.id,
//       );

//     return segmentIds
//       .map(Number)
//       .includes(Number(order.segment_id));
//   }

//   return false;
// }

async function canAccessOrder(order, currentUser) {
  console.log("ORDER ACCESS:", {
    order_id: order.id,
    order_city_id: order.city_id,
    order_segment_id: order.segment_id,
    user_id: currentUser.id,
    user_city_id: currentUser.city_id,
    role: currentUser.role,
  });

  if (!order) {
    return false;
  }

  if (currentUser.role === "SUPER_ADMIN") {
    return true;
  }

  if (currentUser.role === "ADMIN") {
    return Number(order.city_id) === Number(currentUser.city_id);
  }

  if (currentUser.role === "HD") {
    if (
      Number(order.city_id) !==
      Number(currentUser.city_id)
    ) {
      return false;
    }

    const segmentIds =
      await orderRepository.getUserSegmentIds(
        currentUser.id,
      );

    //console.log("USER SEGMENTS:", segmentIds);

    return segmentIds
      .map(Number)
      .includes(Number(order.segment_id));
  }

  return false;
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
  markResultTelegramDelivery,
  getOrderDetail,
  canAccessOrder
};
