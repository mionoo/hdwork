ALTER TABLE order_telegram_messages
  ADD COLUMN is_outbound TINYINT(1) NOT NULL DEFAULT 0;
