//attendance.repository.js

const pool = require("../config/database");

async function clockIn(userId) {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [userRows] = await connection.query(
      `
      SELECT id, role, city_id, is_active
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
      const error = new Error("Hanya HD yang dapat melakukan attendance");
      error.statusCode = 403;
      throw error;
    }

    if (!user.is_active) {
      const error = new Error("User tidak aktif");
      error.statusCode = 403;
      throw error;
    }

    const [existingRows] = await connection.query(
      `
      SELECT id, clock_in_at, clock_out_at
      FROM attendance
      WHERE user_id = ?
        AND work_date = CURDATE()
      FOR UPDATE
      `,
      [userId],
    );

    if (existingRows.length > 0) {
      const error = new Error("User sudah clock in hari ini");
      error.statusCode = 409;
      throw error;
    }

    const [result] = await connection.query(
      `
      INSERT INTO attendance (
        user_id,
        city_id,
        work_date,
        clock_in_at
      )
      VALUES (?, ?, CURDATE(), CURRENT_TIMESTAMP)
      `,
      [userId, user.city_id],
    );

    await connection.commit();

    return {
      attendance_id: Number(result.insertId),
      user_id: Number(userId),
      status: "ON_DESK",
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function startBreak(userId) {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [attendanceRows] = await connection.query(
      `
      SELECT id, clock_in_at, clock_out_at
      FROM attendance
      WHERE user_id = ?
        AND work_date = CURDATE()
      FOR UPDATE
      `,
      [userId],
    );

    if (attendanceRows.length === 0) {
      const error = new Error("User belum clock in hari ini");
      error.statusCode = 409;
      throw error;
    }

    const attendance = attendanceRows[0];

    if (attendance.clock_out_at) {
      const error = new Error("User sudah clock out");
      error.statusCode = 409;
      throw error;
    }

    const [activeBreakRows] = await connection.query(
      `
      SELECT id
      FROM attendance_breaks
      WHERE attendance_id = ?
        AND break_end_at IS NULL
      LIMIT 1
      FOR UPDATE
      `,
      [attendance.id],
    );

    if (activeBreakRows.length > 0) {
      const error = new Error("User sedang dalam status BREAK");
      error.statusCode = 409;
      throw error;
    }

    const [result] = await connection.query(
      `
      INSERT INTO attendance_breaks (
        attendance_id,
        break_start_at
      )
      VALUES (?, CURRENT_TIMESTAMP)
      `,
      [attendance.id],
    );

    await connection.commit();

    return {
      attendance_id: Number(attendance.id),
      break_id: Number(result.insertId),
      status: "BREAK",
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function onDesk(userId) {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [attendanceRows] = await connection.query(
      `
      SELECT id, clock_out_at
      FROM attendance
      WHERE user_id = ?
        AND work_date = CURDATE()
      FOR UPDATE
      `,
      [userId],
    );

    if (attendanceRows.length === 0) {
      const error = new Error("User belum clock in hari ini");
      error.statusCode = 409;
      throw error;
    }

    const attendance = attendanceRows[0];

    if (attendance.clock_out_at) {
      const error = new Error("User sudah clock out");
      error.statusCode = 409;
      throw error;
    }

    const [breakRows] = await connection.query(
      `
      SELECT id
      FROM attendance_breaks
      WHERE attendance_id = ?
        AND break_end_at IS NULL
      ORDER BY break_start_at DESC
      LIMIT 1
      FOR UPDATE
      `,
      [attendance.id],
    );

    if (breakRows.length === 0) {
      const error = new Error("Tidak ada break aktif");
      error.statusCode = 409;
      throw error;
    }

    const activeBreak = breakRows[0];

    await connection.query(
      `
      UPDATE attendance_breaks
      SET break_end_at = CURRENT_TIMESTAMP
      WHERE id = ?
      `,
      [activeBreak.id],
    );

    await connection.commit();

    return {
      attendance_id: Number(attendance.id),
      break_id: Number(activeBreak.id),
      status: "ON_DESK",
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function clockOut(userId) {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [attendanceRows] = await connection.query(
      `
      SELECT id, clock_in_at, clock_out_at
      FROM attendance
      WHERE user_id = ?
        AND work_date = CURDATE()
      FOR UPDATE
      `,
      [userId],
    );

    if (attendanceRows.length === 0) {
      const error = new Error("User belum clock in hari ini");
      error.statusCode = 409;
      throw error;
    }

    const attendance = attendanceRows[0];

    if (attendance.clock_out_at) {
      const error = new Error("User sudah clock out");
      error.statusCode = 409;
      throw error;
    }

    const [activeBreakRows] = await connection.query(
      `
      SELECT id
      FROM attendance_breaks
      WHERE attendance_id = ?
        AND break_end_at IS NULL
      LIMIT 1
      FOR UPDATE
      `,
      [attendance.id],
    );

    if (activeBreakRows.length > 0) {
      const error = new Error(
        "Tidak dapat clock out saat masih BREAK. Kembali On Desk terlebih dahulu.",
      );
      error.statusCode = 409;
      throw error;
    }

    await connection.query(
      `
      UPDATE attendance
      SET
        clock_out_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      `,
      [attendance.id],
    );

    await connection.commit();

    return {
      attendance_id: Number(attendance.id),
      user_id: Number(userId),
      status: "CLOCKED_OUT",
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function getTodayAttendance(userId) {
  const [attendanceRows] = await pool.query(
    `
    SELECT
      id,
      user_id,
      city_id,
      work_date,
      clock_in_at,
      clock_out_at
    FROM attendance
    WHERE user_id = ?
      AND work_date = CURDATE()
    LIMIT 1
    `,
    [userId],
  );

  if (attendanceRows.length === 0) {
    return {
      user_id: Number(userId),
      status: "NOT_CLOCKED_IN",
      attendance: null,
      breaks: [],
    };
  }

  const attendance = attendanceRows[0];

  const [breaks] = await pool.query(
    `
    SELECT
      id,
      break_start_at,
      break_end_at
    FROM attendance_breaks
    WHERE attendance_id = ?
    ORDER BY break_start_at ASC
    `,
    [attendance.id],
  );

  let status = "ON_DESK";

  if (attendance.clock_out_at) {
    status = "CLOCKED_OUT";
  } else {
    const activeBreak = breaks.find(
      (item) => item.break_end_at === null,
    );

    if (activeBreak) {
      status = "BREAK";
    }
  }

  return {
    user_id: Number(userId),
    status,
    attendance,
    breaks,
  };
}

module.exports = {
  clockIn,
  startBreak,
  onDesk,
  clockOut,
  getTodayAttendance
};