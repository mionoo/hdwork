CREATE TABLE IF NOT EXISTS order_telegram_reads (
  user_id BIGINT NOT NULL,
  order_id BIGINT NOT NULL,
  last_read_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (user_id, order_id),
  KEY ix_order_telegram_reads_order (order_id),
  CONSTRAINT fk_telegram_reads_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_telegram_reads_order FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE
);
