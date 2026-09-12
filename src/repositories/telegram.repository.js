const pool = require("../config/database");

const alarmCategoryByCustomerType = {
  nodeb: "ALARM_NODEB",
  datin: "ALARM_DATIN",
};

async function getCities() {
  const [rows] = await pool.query(
    "SELECT id, name FROM cities ORDER BY name ASC",
  );

  return rows;
}

async function getSegments() {
  const [rows] = await pool.query(
    "SELECT id, code FROM segments ORDER BY code ASC",
  );

  return rows;
}

async function getGroupByScope(cityId, segmentId, category) {
  const [rows] = await pool.query(
    `
    SELECT id, telegram_chat_id, telegram_thread_id, name, city_id, segment_id, category, is_active
    FROM telegram_groups
    WHERE city_id = ?
      AND segment_id = ?
      AND category = ?
    LIMIT 1
    `,
    [cityId, segmentId, category],
  );

  return rows[0] || null;
}

async function saveGroup({
  chatId,
  threadId,
  name,
  cityId,
  segmentId,
  category,
}) {
  const [result] = await pool.query(
    `
    INSERT INTO telegram_groups (
      telegram_chat_id,
      telegram_thread_id,
      name,
      city_id,
      segment_id,
      category,
      is_active
    )
    VALUES (?, ?, ?, ?, ?, ?, 1)
    ON DUPLICATE KEY UPDATE
      name = VALUES(name),
      city_id = VALUES(city_id),
      segment_id = VALUES(segment_id),
      category = VALUES(category),
      is_active = 1,
      updated_at = CURRENT_TIMESTAMP
    `,
    [chatId, threadId, name, cityId, segmentId, category],
  );

  return result;
}

async function getGroupByChatThread(chatId, threadId) {
  const [rows] = await pool.query(
    `
    SELECT id, name, category, is_active
    FROM telegram_groups
    WHERE telegram_chat_id = ? AND telegram_thread_id = ?
    LIMIT 1
    `,
    [chatId, threadId],
  );

  return rows[0] || null;
}

async function moveGroupBinding({ groupId, chatId, threadId, name }) {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [existingBinding] = await connection.query(
      `
      SELECT id, name
      FROM telegram_groups
      WHERE telegram_chat_id = ? AND telegram_thread_id = ?
      FOR UPDATE
      `,
      [chatId, threadId],
    );

    if (existingBinding[0] && Number(existingBinding[0].id) !== Number(groupId)) {
      const error = new Error(
        `Grup/topic ini sudah dipakai oleh konfigurasi ${existingBinding[0].name}`,
      );
      error.statusCode = 409;
      throw error;
    }

    await connection.query(
      `
      UPDATE telegram_groups
      SET telegram_chat_id = ?, telegram_thread_id = ?, name = ?, is_active = 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      `,
      [chatId, threadId, name, groupId],
    );

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

function getAlarmCategory(customerType) {
  return alarmCategoryByCustomerType[String(customerType || "").toLowerCase()] || null;
}

async function saveAlarmGroup({ chatId, threadId, name, category }) {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [boundRows] = await connection.query(
      `
      SELECT id, category
      FROM telegram_groups
      WHERE telegram_chat_id = ? AND telegram_thread_id = ?
      FOR UPDATE
      `,
      [chatId, threadId],
    );

    const boundGroup = boundRows[0];
    if (boundGroup && boundGroup.category !== category) {
      const error = new Error("Grup/topic ini sudah dipakai oleh konfigurasi lain.");
      error.statusCode = 409;
      throw error;
    }

    const [categoryRows] = await connection.query(
      `
      SELECT id
      FROM telegram_groups
      WHERE category = ?
      FOR UPDATE
      `,
      [category],
    );

    const categoryGroup = categoryRows[0];
    if (categoryGroup) {
      await connection.query(
        `
        UPDATE telegram_groups
        SET telegram_chat_id = ?, telegram_thread_id = ?, name = ?, is_active = 1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        `,
        [chatId, threadId, name, categoryGroup.id],
      );
    } else {
      await connection.query(
        `
        INSERT INTO telegram_groups (
          telegram_chat_id,
          telegram_thread_id,
          name,
          city_id,
          segment_id,
          category,
          is_active
        )
        VALUES (?, ?, ?, NULL, NULL, ?, 1)
        `,
        [chatId, threadId, name, category],
      );
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function getAlarmDestination(customerType) {
  const category = getAlarmCategory(customerType);
  if (!category) return null;

  const [rows] = await pool.query(
    `
    SELECT telegram_chat_id, telegram_thread_id, name
    FROM telegram_groups
    WHERE category = ? AND is_active = 1
    LIMIT 1
    `,
    [category],
  );

  return rows[0] || null;
}

async function saveAlarmSubscriber({ customerType, userId, chatId, username, displayName }) {
  if (!getAlarmCategory(customerType)) {
    throw new Error("Jenis alarm tidak dikenal.");
  }

  await pool.query(
    `
    INSERT INTO telegram_alarm_subscribers (
      customer_type, telegram_user_id, telegram_chat_id, telegram_username, display_name, is_active
    )
    VALUES (?, ?, ?, ?, ?, 1)
    ON DUPLICATE KEY UPDATE
      telegram_chat_id = VALUES(telegram_chat_id),
      telegram_username = VALUES(telegram_username),
      display_name = VALUES(display_name),
      is_active = 1,
      updated_at = CURRENT_TIMESTAMP
    `,
    [String(customerType).toLowerCase(), userId, chatId, username || null, displayName || null],
  );
}

async function deactivateAlarmSubscriber(customerType, userId) {
  await pool.query(
    `
    UPDATE telegram_alarm_subscribers
    SET is_active = 0, updated_at = CURRENT_TIMESTAMP
    WHERE customer_type = ? AND telegram_user_id = ?
    `,
    [String(customerType).toLowerCase(), userId],
  );
}

async function getAlarmSubscribers(customerType) {
  const [rows] = await pool.query(
    `
    SELECT id, telegram_user_id, telegram_chat_id, telegram_username, display_name
    FROM telegram_alarm_subscribers
    WHERE customer_type = ? AND is_active = 1
    ORDER BY id ASC
    `,
    [String(customerType).toLowerCase()],
  );

  return rows;
}

async function getAlarmSubscriptions(userId) {
  const [rows] = await pool.query(
    `
    SELECT customer_type
    FROM telegram_alarm_subscribers
    WHERE telegram_user_id = ? AND is_active = 1
    ORDER BY customer_type ASC
    `,
    [userId],
  );

  return rows;
}

module.exports = {
  getCities,
  getSegments,
  getGroupByScope,
  getGroupByChatThread,
  moveGroupBinding,
  saveGroup,
  getAlarmCategory,
  getAlarmDestination,
  saveAlarmGroup,
  saveAlarmSubscriber,
  deactivateAlarmSubscriber,
  getAlarmSubscribers,
  getAlarmSubscriptions,
};
