-- Apply before setting TELEGRAM_OUTBOX_ENABLED=true. No bot token is stored.
CREATE TABLE IF NOT EXISTS telegram_outbox (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  bot_id BIGINT UNSIGNED NOT NULL,
  job_key VARCHAR(120) NOT NULL,
  kind ENUM('result', 'claim') NOT NULL,
  payload JSON NOT NULL,
  status ENUM('pending', 'sending', 'sent', 'failed', 'unknown') NOT NULL DEFAULT 'pending',
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  next_attempt_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  lease_token CHAR(36) NULL,
  lease_until DATETIME(3) NULL,
  last_error TEXT NULL,
  delivery JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_telegram_outbox_job (bot_id, job_key),
  KEY ix_telegram_outbox_ready (bot_id, status, next_attempt_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
