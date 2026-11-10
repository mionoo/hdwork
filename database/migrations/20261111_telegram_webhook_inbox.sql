CREATE TABLE IF NOT EXISTS telegram_webhook_updates (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  bot_id BIGINT UNSIGNED NOT NULL,
  update_id BIGINT UNSIGNED NOT NULL,
  payload JSON NOT NULL,
  status ENUM('pending', 'processing', 'done') NOT NULL DEFAULT 'pending',
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  next_attempt_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  lease_token CHAR(36) NULL,
  lease_until DATETIME(3) NULL,
  last_error VARCHAR(500) NULL,
  received_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  processed_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_telegram_webhook_update (bot_id, update_id),
  KEY ix_telegram_webhook_pending (bot_id, status, update_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
