//order.repository.js

const pool = require("../config/database");

async function getAllOrders(filters = {}) {
  const { status, city_id, segment_id, user_id, allowed_segment_ids } = filters;

  // HD tidak punya segment sama sekali
  // jangan tampilkan order apa pun
  if (Array.isArray(allowed_segment_ids) && allowed_segment_ids.length === 0) {
    return [];
  }

  let sql = `
    SELECT
      o.id,
      o.ticket_number,
      o.service_number,
      o.sto,
      o.description,
      o.telegram_username,

      tg.id AS telegram_group_id,
      tg.name AS telegram_group,
      tg.category AS telegram_group_category,

      c.id AS city_id,
      c.name AS city_name,

      s.id AS segment_id,
      s.code AS segment_code,

      ot.code AS order_type,

      o.point_value,
      o.status,

      o.performance_owner_id,
      u.name AS performance_owner_name,

      o.created_at,
      o.completed_at

    FROM orders o

    JOIN telegram_groups tg
      ON tg.id = o.telegram_group_id

    JOIN cities c
      ON c.id = tg.city_id

    JOIN segments s
      ON s.id = tg.segment_id

    JOIN order_types ot
      ON ot.id = o.order_type_id

    LEFT JOIN users u
      ON u.id = o.performance_owner_id

    WHERE 1 = 1
  `;

  const params = [];

  if (status) {
    sql += ` AND o.status = ?`;
    params.push(status);
  }

  if (city_id) {
    sql += ` AND tg.city_id = ?`;
    params.push(city_id);
  }

  if (segment_id) {
    sql += ` AND tg.segment_id = ?`;
    params.push(segment_id);
  }

  if (Array.isArray(allowed_segment_ids) && allowed_segment_ids.length > 0) {
    const placeholders = allowed_segment_ids.map(() => "?").join(",");

    sql += `
      AND tg.segment_id IN (${placeholders})
    `;

    params.push(...allowed_segment_ids);
  }

  if (user_id) {
    sql += ` AND o.performance_owner_id = ?`;
    params.push(user_id);
  }

  sql += ` ORDER BY o.created_at DESC`;

  const [rows] = await pool.query(sql, params);

  return rows;
}

async function getUserSegmentIds(userId) {
  const [rows] = await pool.query(
    `
    SELECT segment_id
    FROM user_segments
    WHERE user_id = ?
    `,
    [userId],
  );

  return rows.map((row) => row.segment_id);
}

async function getOrderById(id) {
  const [rows] = await pool.query(
    `
    SELECT
      o.id,
      o.ticket_number,
      o.service_number,
      o.old_ont_serial,
      o.new_ont_serial,
      o.sto,
      o.valin_id,
      o.description,
      o.raw_message,
      o.metadata,
      o.telegram_user_id,
      o.telegram_username,

      tg.name AS telegram_group,
      tg.city_id,
      tg.segment_id,

      ot.code AS order_type,

      o.point_value,
      o.status,
      o.performance_owner_id,
      o.created_at,
      o.updated_at,
      o.completed_at

    FROM orders o

    JOIN telegram_groups tg
      ON tg.id = o.telegram_group_id

    JOIN order_types ot
      ON ot.id = o.order_type_id

    WHERE o.id = ?

    LIMIT 1
    `,
    [id],
  );

  return rows[0] || null;
}

async function claimOrder(orderId, userId) {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // 1. Ambil + lock order
    const [orderRows] = await connection.query(
      `
      SELECT
        o.id,
        o.status,
        o.telegram_chat_id,
        o.telegram_message_id,
        o.telegram_group_id,
        tg.telegram_thread_id,
        tg.city_id,
        tg.segment_id
      FROM orders o
      JOIN telegram_groups tg
        ON tg.id = o.telegram_group_id
      WHERE o.id = ?
      FOR UPDATE
      `,
      [orderId],
    );

    // 2. Pastikan order ada
    if (orderRows.length === 0) {
      const error = new Error("Order tidak ditemukan");
      error.statusCode = 404;
      throw error;
    }

    const order = orderRows[0];

    // 3. Pastikan masih WAITING
    if (order.status !== "WAITING") {
      const error = new Error("Order sudah di-claim atau tidak tersedia");
      error.statusCode = 409;
      throw error;
    }

    // 4. Ambil user
    const [userRows] = await connection.query(
      `
      SELECT
        id,
        name,
        role,
        city_id,
        is_active
      FROM users
      WHERE id = ?
      `,
      [userId],
    );

    // 5. Pastikan user ada
    if (userRows.length === 0) {
      const error = new Error("User tidak ditemukan");
      error.statusCode = 404;
      throw error;
    }

    const user = userRows[0];

    // 6. Pastikan role HD
    if (user.role !== "HD") {
      const error = new Error("Hanya HD yang dapat claim order");
      error.statusCode = 403;
      throw error;
    }

    // 7. Pastikan user aktif
    if (!user.is_active) {
      const error = new Error("User tidak aktif");
      error.statusCode = 403;
      throw error;
    }

    // 8. Validasi city
    if (user.city_id !== order.city_id) {
      const error = new Error("Order berada di luar city HD");
      error.statusCode = 403;
      throw error;
    }

    // 9. Validasi segment
    const [segmentRows] = await connection.query(
      `
      SELECT 1
      FROM user_segments
      WHERE user_id = ?
        AND segment_id = ?
      LIMIT 1
      `,
      [userId, order.segment_id],
    );

    if (segmentRows.length === 0) {
      const error = new Error("Order berada di luar segment HD");
      error.statusCode = 403;
      throw error;
    }

    // 10. Cek jumlah active order HD
    const [activeRows] = await connection.query(
      `
      SELECT COUNT(*) AS total_active
      FROM order_assignments
      WHERE user_id = ?
        AND released_at IS NULL
      `,
      [userId],
    );

    const totalActive = Number(activeRows[0].total_active);

    if (totalActive >= 10) {
      const error = new Error("Maksimal 10 active order");
      error.statusCode = 409;
      throw error;
    }

    // 11. Buat assignment
    await connection.query(
      `
      INSERT INTO order_assignments (
        order_id,
        user_id
      )
      VALUES (?, ?)
      `,
      [orderId, userId],
    );

    // 12. Catat event CLAIMED
    await connection.query(
      `
      INSERT INTO order_events (
        order_id,
        event_type,
        actor_type,
        actor_user_id,
        target_user_id
      )
      VALUES (?, 'CLAIMED', 'USER', ?, NULL)
      `,
      [orderId, userId],
    );

    // 13. Update order
    await connection.query(
      `
      UPDATE orders
      SET
        status = 'IN_PROGRESS',
        performance_owner_id = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      `,
      [userId, orderId],
    );

    // 14. Simpan seluruh transaksi
    await connection.commit();

    return {
      order_id: Number(orderId),
      user_id: Number(userId),
      user_name: user.name,
      status: "IN_PROGRESS",
      telegram_chat_id: order.telegram_chat_id,
      telegram_message_id: order.telegram_message_id,
      telegram_thread_id: order.telegram_thread_id,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function createIncomingOrder({
  group,
  message,
  orderType,
  ticketNumber,
  serviceNumber,
  description,
  oldOntSerial,
  newOntSerial,
  sto,
  valinId,
  metadata,
}) {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    const [types] = await connection.query(
      "SELECT id, point_value FROM order_types WHERE code = ? AND is_active = 1 LIMIT 1",
      [orderType],
    );
    if (!types[0]) {
      const error = new Error(`Tipe order ${orderType} tidak tersedia`);
      error.statusCode = 400;
      throw error;
    }
    const [result] = await connection.query(
      `
      INSERT INTO orders (
        ticket_number, service_number, description, raw_message, metadata,
        old_ont_serial, new_ont_serial, sto, valin_id,
        telegram_chat_id, telegram_message_id, telegram_user_id, telegram_username,
        telegram_group_id, order_type_id, point_value, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'WAITING')
      `,
      [
        ticketNumber || null, serviceNumber || null, description, message.text,
        JSON.stringify(metadata || {}), oldOntSerial || null, newOntSerial || null,
        sto || null, valinId || null, message.chat.id, message.message_id,
        message.from?.id || null, message.from?.username || null, group.id,
        types[0].id, types[0].point_value,
      ],
    );
    await connection.commit();
    return { id: Number(result.insertId) };
  } catch (error) {
    await connection.rollback();
    if (error.code === "ER_DUP_ENTRY") return null;
    throw error;
  } finally {
    connection.release();
  }
}

async function getReassignTargets(cityId, segmentId, actorUserId) {
  const [rows] = await pool.query(
    `
    SELECT
      u.id,
      u.name,
      u.username,
      COUNT(oa.id) AS active_orders
    FROM users u
    JOIN user_segments us
      ON us.user_id = u.id
    LEFT JOIN order_assignments oa
      ON oa.user_id = u.id
      AND oa.released_at IS NULL
    WHERE u.role = 'HD'
      AND u.is_active = 1
      AND u.city_id = ?
      AND us.segment_id = ?
      AND u.id != ?
    GROUP BY u.id, u.name, u.username
    HAVING COUNT(oa.id) < 10
    ORDER BY u.name ASC
    `,
    [cityId, segmentId, actorUserId],
  );

  return rows.map((row) => ({
    ...row,
    active_orders: Number(row.active_orders),
  }));
}

async function reassignOrder(orderId, actorUserId, targetUserId, reason) {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // 1. Lock order
    const [orderRows] = await connection.query(
      `
      SELECT
        o.id,
        o.status,
        o.telegram_group_id,
        o.performance_owner_id,
        tg.city_id,
        tg.segment_id
      FROM orders o
      JOIN telegram_groups tg
        ON tg.id = o.telegram_group_id
      WHERE o.id = ?
      FOR UPDATE
      `,
      [orderId],
    );

    if (orderRows.length === 0) {
      const error = new Error("Order tidak ditemukan");
      error.statusCode = 404;
      throw error;
    }

    const order = orderRows[0];

    // 2. Harus masih IN_PROGRESS
    if (order.status !== "IN_PROGRESS") {
      const error = new Error("Order tidak dalam status IN_PROGRESS");
      error.statusCode = 409;
      throw error;
    }

    // 3. Cari assignment aktif
    const [assignmentRows] = await connection.query(
      `
      SELECT
        id,
        user_id
      FROM order_assignments
      WHERE order_id = ?
        AND released_at IS NULL
      LIMIT 1
      FOR UPDATE
      `,
      [orderId],
    );

    if (assignmentRows.length === 0) {
      const error = new Error("Order tidak memiliki assignment aktif");
      error.statusCode = 409;
      throw error;
    }

    const currentAssignment = assignmentRows[0];

    // 4. Actor harus HD yang sedang memegang order
    if (Number(currentAssignment.user_id) !== Number(actorUserId)) {
      const error = new Error("User bukan pemegang aktif order ini");
      error.statusCode = 403;
      throw error;
    }

    // 5. Tidak boleh reassign ke diri sendiri
    if (Number(actorUserId) === Number(targetUserId)) {
      const error = new Error(
        "Order tidak dapat di-reassign ke user yang sama",
      );
      error.statusCode = 400;
      throw error;
    }

    // 6. Cek target user
    const [targetRows] = await connection.query(
      `
      SELECT
        id,
        role,
        city_id,
        is_active
      FROM users
      WHERE id = ?
      `,
      [targetUserId],
    );

    if (targetRows.length === 0) {
      const error = new Error("HD tujuan tidak ditemukan");
      error.statusCode = 404;
      throw error;
    }

    const targetUser = targetRows[0];

    if (targetUser.role !== "HD") {
      const error = new Error("Target reassign harus user HD");
      error.statusCode = 403;
      throw error;
    }

    if (!targetUser.is_active) {
      const error = new Error("HD tujuan sedang tidak aktif");
      error.statusCode = 403;
      throw error;
    }

    // 7. City harus sama
    if (targetUser.city_id !== order.city_id) {
      const error = new Error("HD tujuan berada di city yang berbeda");
      error.statusCode = 403;
      throw error;
    }

    // 8. Segment harus sesuai
    const [segmentRows] = await connection.query(
      `
      SELECT 1
      FROM user_segments
      WHERE user_id = ?
        AND segment_id = ?
      LIMIT 1
      `,
      [targetUserId, order.segment_id],
    );

    if (segmentRows.length === 0) {
      const error = new Error("HD tujuan tidak memiliki segment yang sesuai");
      error.statusCode = 403;
      throw error;
    }

    // 9. Target maksimal 10 active orders
    const [activeRows] = await connection.query(
      `
      SELECT COUNT(*) AS total_active
      FROM order_assignments
      WHERE user_id = ?
        AND released_at IS NULL
      `,
      [targetUserId],
    );

    const totalActive = Number(activeRows[0].total_active);

    if (totalActive >= 10) {
      const error = new Error(
        "HD tujuan sudah memiliki maksimal 10 active order",
      );
      error.statusCode = 409;
      throw error;
    }

    // 10. Release assignment lama
    await connection.query(
      `
      UPDATE order_assignments
      SET
        released_at = CURRENT_TIMESTAMP,
        release_reason = 'REASSIGN'
      WHERE id = ?
      `,
      [currentAssignment.id],
    );

    // 11. Buat assignment baru
    await connection.query(
      `
      INSERT INTO order_assignments (
        order_id,
        user_id
      )
      VALUES (?, ?)
      `,
      [orderId, targetUserId],
    );

    // 12. Buat event REASSIGNED
    const [eventResult] = await connection.query(
      `
      INSERT INTO order_events (
        order_id,
        event_type,
        actor_type,
        actor_user_id,
        target_user_id
      )
      VALUES (?, 'REASSIGNED', 'USER', ?, ?)
      `,
      [orderId, actorUserId, targetUserId],
    );

    // 13. Simpan alasan reassign
    await connection.query(
      `
      INSERT INTO order_notes (
        order_id,
        event_id,
        user_id,
        note_type,
        content
      )
      VALUES (?, ?, ?, 'REASSIGN', ?)
      `,
      [orderId, eventResult.insertId, actorUserId, reason],
    );

    // 14. Performance owner pindah ke HD baru
    await connection.query(
      `
      UPDATE orders
      SET
        performance_owner_id = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      `,
      [targetUserId, orderId],
    );

    await connection.commit();

    return {
      order_id: Number(orderId),
      from_user_id: Number(actorUserId),
      to_user_id: Number(targetUserId),
      status: "IN_PROGRESS",
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function escalateOrder(orderId, actorUserId, reason) {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // 1. Lock order
    const [orderRows] = await connection.query(
      `
      SELECT
        o.id,
        o.status,
        o.performance_owner_id,
        o.telegram_chat_id,
        o.telegram_message_id,
        tg.telegram_thread_id
      FROM orders o
      JOIN telegram_groups tg ON tg.id = o.telegram_group_id
      WHERE o.id = ?
      FOR UPDATE
      `,
      [orderId],
    );

    if (orderRows.length === 0) {
      const error = new Error("Order tidak ditemukan");
      error.statusCode = 404;
      throw error;
    }

    const order = orderRows[0];

    // 2. Order harus IN_PROGRESS
    if (order.status !== "IN_PROGRESS") {
      const error = new Error("Order tidak dalam status IN_PROGRESS");
      error.statusCode = 409;
      throw error;
    }

    // 3. Cari assignment aktif
    const [assignmentRows] = await connection.query(
      `
      SELECT
        id,
        user_id
      FROM order_assignments
      WHERE order_id = ?
        AND released_at IS NULL
      LIMIT 1
      FOR UPDATE
      `,
      [orderId],
    );

    if (assignmentRows.length === 0) {
      const error = new Error("Order tidak memiliki assignment aktif");
      error.statusCode = 409;
      throw error;
    }

    const assignment = assignmentRows[0];

    // 4. Actor harus pemegang aktif order
    if (Number(assignment.user_id) !== Number(actorUserId)) {
      const error = new Error("User bukan pemegang aktif order ini");
      error.statusCode = 403;
      throw error;
    }

    // 5. Release assignment
    await connection.query(
      `
      UPDATE order_assignments
      SET
        released_at = CURRENT_TIMESTAMP,
        release_reason = 'ESCALATED'
      WHERE id = ?
      `,
      [assignment.id],
    );

    // 6. Buat event ESCALATED
    const [eventResult] = await connection.query(
      `
      INSERT INTO order_events (
        order_id,
        event_type,
        actor_type,
        actor_user_id,
        target_user_id
      )
      VALUES (?, 'ESCALATED', 'USER', ?, NULL)
      `,
      [orderId, actorUserId],
    );

    // 7. Simpan alasan escalate
    await connection.query(
      `
      INSERT INTO order_notes (
        order_id,
        event_id,
        user_id,
        note_type,
        content
      )
      VALUES (?, ?, ?, 'ESCALATE', ?)
      `,
      [orderId, eventResult.insertId, actorUserId, reason],
    );

    // 8. Update order
    // performance_owner_id TIDAK diubah
    await connection.query(
      `
      UPDATE orders
      SET
        status = 'ESCALATED',
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      `,
      [orderId],
    );

    await connection.commit();

    return {
      order_id: Number(orderId),
      actor_user_id: Number(actorUserId),
      performance_owner_id: Number(order.performance_owner_id),
      status: "ESCALATED",
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function sendResult(
  orderId,
  userId,
  content,
  telegramChatId,
  telegramMessageId,
  files,
) {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // 1. Ambil dan lock order
    const [orderRows] = await connection.query(
      `
      SELECT
        o.id,
        o.status,
        o.performance_owner_id,
        o.telegram_chat_id,
        o.telegram_message_id,
        tg.telegram_thread_id
      FROM orders o
      JOIN telegram_groups tg ON tg.id = o.telegram_group_id
      WHERE o.id = ?
      FOR UPDATE
      `,
      [orderId],
    );

    if (orderRows.length === 0) {
      const error = new Error("Order tidak ditemukan");
      error.statusCode = 404;
      throw error;
    }

    const order = orderRows[0];

    // 2. Result hanya boleh dikirim saat
    // IN_PROGRESS atau ESCALATED
    if (order.status !== "IN_PROGRESS" && order.status !== "ESCALATED") {
      const error = new Error(
        "Result hanya dapat dikirim untuk order IN_PROGRESS atau ESCALATED",
      );
      error.statusCode = 409;
      throw error;
    }

    // 3. Cek user
    const [userRows] = await connection.query(
      `
      SELECT
        id,
        role,
        is_active,
        name
      FROM users
      WHERE id = ?
      `,
      [userId],
    );

    if (userRows.length === 0) {
      const error = new Error("User tidak ditemukan");
      error.statusCode = 404;
      throw error;
    }

    const user = userRows[0];

    if (user.role !== "HD") {
      const error = new Error("Hanya HD yang dapat mengirim result");
      error.statusCode = 403;
      throw error;
    }

    if (!user.is_active) {
      const error = new Error("User tidak aktif");
      error.statusCode = 403;
      throw error;
    }

    // 4. Yang boleh kirim result adalah
    // performance owner dari order
    if (Number(order.performance_owner_id) !== Number(userId)) {
      const error = new Error("User bukan performance owner order ini");
      error.statusCode = 403;
      throw error;
    }

    // 5. Simpan result
    const [resultInsert] = await connection.query(
      `
      INSERT INTO order_results (
        order_id,
        user_id,
        content,
        telegram_chat_id,
        telegram_message_id
      )
      VALUES (?, ?, ?, ?, ?)
      `,
      [orderId, userId, content, null, null],
    );

    const resultId = resultInsert.insertId;

    // Simpan file jika ada
    for (const file of files) {
      if (!file.file_name || !file.file_url) {
        const error = new Error(
          "Setiap file wajib memiliki file_name dan file_url",
        );
        error.statusCode = 400;
        throw error;
      }

      await connection.query(
        `
    INSERT INTO order_result_files (
      order_result_id,
      file_name,
      file_url,
      mime_type,
      file_size,
      telegram_file_id
    )
    VALUES (?, ?, ?, ?, ?, ?)
    `,
        [
          resultId,
          file.file_name,
          file.file_url,
          file.mime_type || null,
          file.file_size || null,
          file.telegram_file_id || null,
        ],
      );
    }

    // 6. Buat event RESULT_SENT
    await connection.query(
      `
      INSERT INTO order_events (
        order_id,
        event_type,
        actor_type,
        actor_user_id,
        target_user_id
      )
      VALUES (?, 'RESULT_SENT', 'USER', ?, NULL)
      `,
      [orderId, userId],
    );

    // 7. Tidak mengubah status order
    await connection.query(
      `
      UPDATE orders
      SET updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      `,
      [orderId],
    );

    await connection.commit();

    return {
      result_id: Number(resultInsert.insertId),
      order_id: Number(orderId),
      user_id: Number(userId),
      status: order.status,
      files_count: files.length,
      telegram: {
        chat_id: order.telegram_chat_id,
        message_id: order.telegram_message_id,
        thread_id: order.telegram_thread_id,
        user_name: user.name,
        content: content || null,
        files,
      },
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function completeOrder(orderId, userId, completionResult = {}) {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // 1. Lock order
    const [orderRows] = await connection.query(
      `
      SELECT
        o.id,
        o.status,
        o.performance_owner_id,
        o.completed_at,
        o.telegram_chat_id,
        o.telegram_message_id,
        tg.telegram_thread_id
      FROM orders o
      JOIN telegram_groups tg ON tg.id = o.telegram_group_id
      WHERE o.id = ?
      FOR UPDATE
      `,
      [orderId],
    );

    if (orderRows.length === 0) {
      const error = new Error("Order tidak ditemukan");
      error.statusCode = 404;
      throw error;
    }

    const order = orderRows[0];

    // 2. Jangan complete kalau sudah DONE
    if (order.status === "DONE") {
      const error = new Error("Order sudah selesai");
      error.statusCode = 409;
      throw error;
    }

    // 3. Hanya IN_PROGRESS atau ESCALATED
    if (order.status !== "IN_PROGRESS" && order.status !== "ESCALATED") {
      const error = new Error(
        "Order hanya dapat diselesaikan dari status IN_PROGRESS atau ESCALATED",
      );
      error.statusCode = 409;
      throw error;
    }

    // 4. Cek user
    const [userRows] = await connection.query(
      `
      SELECT
        id,
        role,
        is_active,
        name
      FROM users
      WHERE id = ?
      `,
      [userId],
    );

    if (userRows.length === 0) {
      const error = new Error("User tidak ditemukan");
      error.statusCode = 404;
      throw error;
    }

    const user = userRows[0];

    if (user.role !== "HD") {
      const error = new Error("Hanya HD yang dapat menyelesaikan order");
      error.statusCode = 403;
      throw error;
    }

    if (!user.is_active) {
      const error = new Error("User tidak aktif");
      error.statusCode = 403;
      throw error;
    }

    // 5. Hanya performance owner
    if (Number(order.performance_owner_id) !== Number(userId)) {
      const error = new Error("User bukan performance owner order ini");
      error.statusCode = 403;
      throw error;
    }

    // 6. Order wajib memiliki result. Jika belum ada, simpan hasil yang
    // dikirim bersamaan dengan proses complete dalam transaksi yang sama.
    const [existingResults] = await connection.query(
      `
      SELECT id
      FROM order_results
      WHERE order_id = ?
      LIMIT 1
      FOR UPDATE
      `,
      [orderId],
    );

    const resultContent = completionResult.content?.trim() || null;
    const resultFiles = completionResult.files || [];

    let createdResult = null;

    if (existingResults.length === 0) {
      if (!resultContent && resultFiles.length === 0) {
        const error = new Error(
          "Hasil pekerjaan wajib diisi sebelum order diselesaikan",
        );
        error.statusCode = 400;
        throw error;
      }

      const [resultInsert] = await connection.query(
        `
        INSERT INTO order_results (
          order_id,
          user_id,
          content,
          telegram_chat_id,
          telegram_message_id
        )
        VALUES (?, ?, ?, NULL, NULL)
        `,
        [orderId, userId, resultContent],
      );

      createdResult = {
        result_id: Number(resultInsert.insertId),
        content: resultContent,
        files: resultFiles,
      };

      for (const file of resultFiles) {
        await connection.query(
          `
          INSERT INTO order_result_files (
            order_result_id,
            file_name,
            file_url,
            mime_type,
            file_size,
            telegram_file_id
          )
          VALUES (?, ?, ?, ?, ?, NULL)
          `,
          [
            resultInsert.insertId,
            file.file_name,
            file.file_url,
            file.mime_type || null,
            file.file_size || null,
          ],
        );
      }

      await connection.query(
        `
        INSERT INTO order_events (
          order_id,
          event_type,
          actor_type,
          actor_user_id,
          target_user_id
        )
        VALUES (?, 'RESULT_SENT', 'USER', ?, NULL)
        `,
        [orderId, userId],
      );
    }

    // 7. Cari assignment aktif kalau ada
    const [assignmentRows] = await connection.query(
      `
      SELECT
        id,
        user_id
      FROM order_assignments
      WHERE order_id = ?
        AND released_at IS NULL
      LIMIT 1
      FOR UPDATE
      `,
      [orderId],
    );

    // Kalau masih ada assignment aktif,
    // release dengan reason DONE
    if (assignmentRows.length > 0) {
      const assignment = assignmentRows[0];

      if (Number(assignment.user_id) !== Number(userId)) {
        const error = new Error(
          "Assignment aktif bukan milik performance owner",
        );
        error.statusCode = 409;
        throw error;
      }

      await connection.query(
        `
        UPDATE order_assignments
        SET
          released_at = CURRENT_TIMESTAMP,
          release_reason = 'DONE'
        WHERE id = ?
        `,
        [assignment.id],
      );
    }

    // 8. Buat event DONE
    await connection.query(
      `
      INSERT INTO order_events (
        order_id,
        event_type,
        actor_type,
        actor_user_id,
        target_user_id
      )
      VALUES (?, 'DONE', 'USER', ?, NULL)
      `,
      [orderId, userId],
    );

    // 9. Update order
    await connection.query(
      `
      UPDATE orders
      SET
        status = 'DONE',
        completed_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      `,
      [orderId],
    );

    await connection.commit();

    return {
      order_id: Number(orderId),
      user_id: Number(userId),
      status: "DONE",
      telegram: {
        chat_id: order.telegram_chat_id,
        message_id: order.telegram_message_id,
        thread_id: order.telegram_thread_id,
        user_name: user.name,
        result: createdResult,
      },
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function markResultTelegramDelivery(resultId, chatId, messageId, threadId = null) {
  if (!resultId || !chatId || !messageId) return;
  await pool.query(
    `
    UPDATE order_results
    SET telegram_chat_id = ?, telegram_message_id = ?, telegram_thread_id = ?
    WHERE id = ?
    `,
    [chatId, messageId, threadId || null, resultId],
  );
}

async function getOrderDetail(orderId) {
  const connection = await pool.getConnection();

  try {
    const [orderRows] = await connection.query(
      `
  SELECT
    o.id,
    o.ticket_number,
    o.service_number,
    o.old_ont_serial,
    o.new_ont_serial,
    o.sto,
    o.valin_id,
    o.description,
    o.raw_message,
    o.metadata,
    o.telegram_user_id,
    o.telegram_username,
    o.point_value,
    o.status,
    o.performance_owner_id,

    u.name AS performance_owner_name,

    tg.name AS telegram_group,

    tg.city_id,
    c.name AS city_name,

    tg.segment_id,
    s.code AS segment_code,

    ot.code AS order_type,

    o.created_at,
    o.updated_at,
    o.completed_at

  FROM orders o

  JOIN telegram_groups tg
    ON tg.id = o.telegram_group_id

  JOIN cities c
        ON c.id = tg.city_id

  JOIN segments s
    ON s.id = tg.segment_id

  JOIN order_types ot
    ON ot.id = o.order_type_id

  LEFT JOIN users u
    ON u.id = o.performance_owner_id

  WHERE o.id = ?

  LIMIT 1
  `,
      [orderId],
    );

    if (orderRows.length === 0) {
      return null;
    }

    const order = orderRows[0];

    const [assignments] = await connection.query(
      `
      SELECT
        oa.id,
        oa.user_id,
        u.name AS user_name,
        oa.assigned_at,
        oa.released_at,
        oa.release_reason
      FROM order_assignments oa
      JOIN users u
        ON u.id = oa.user_id
      WHERE oa.order_id = ?
      ORDER BY oa.assigned_at ASC
      `,
      [orderId],
    );

    const [events] = await connection.query(
      `
      SELECT
        oe.id,
        oe.event_type,
        oe.actor_type,
        oe.actor_user_id,
        actor.name AS actor_name,
        oe.target_user_id,
        target.name AS target_name,
        oe.created_at
      FROM order_events oe
      LEFT JOIN users actor
        ON actor.id = oe.actor_user_id
      LEFT JOIN users target
        ON target.id = oe.target_user_id
      WHERE oe.order_id = ?
      ORDER BY oe.created_at ASC
      `,
      [orderId],
    );

    const [notes] = await connection.query(
      `
      SELECT
        n.id,
        n.event_id,
        n.user_id,
        u.name AS user_name,
        n.note_type,
        n.content,
        n.created_at
      FROM order_notes n
      JOIN users u
        ON u.id = n.user_id
      WHERE n.order_id = ?
      ORDER BY n.created_at ASC
      `,
      [orderId],
    );

    const [results] = await connection.query(
      `
      SELECT
        r.id,
        r.user_id,
        u.name AS user_name,
        r.content,
        r.telegram_chat_id,
        r.telegram_message_id,
        r.created_at
      FROM order_results r
      JOIN users u
        ON u.id = r.user_id
      WHERE r.order_id = ?
      ORDER BY r.created_at ASC
      `,
      [orderId],
    );

    for (const result of results) {
      const [files] = await connection.query(
        `
        SELECT
          id,
          file_name,
          file_url,
          mime_type,
          file_size,
          telegram_file_id,
          created_at
        FROM order_result_files
        WHERE order_result_id = ?
        ORDER BY created_at ASC
        `,
        [result.id],
      );

      result.files = files;
    }

    return {
      order,
      assignments,
      events,
      notes,
      results,
    };
  } finally {
    connection.release();
  }
}



module.exports = {
  getAllOrders,
  getUserSegmentIds,
  getOrderById,
  createIncomingOrder,
  claimOrder,
  getReassignTargets,
  reassignOrder,
  escalateOrder,
  sendResult,
  completeOrder,
  markResultTelegramDelivery,
  getOrderDetail,
};
