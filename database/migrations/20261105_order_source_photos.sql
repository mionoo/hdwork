ALTER TABLE orders
  ADD COLUMN telegram_media_group_id VARCHAR(64) NULL,
  ADD UNIQUE KEY uq_order_telegram_album (telegram_chat_id, telegram_media_group_id);

-- Photo updates can arrive before the caption in an album. Keep their Telegram
-- references until a recognized caption creates the order.
CREATE TABLE order_source_photos (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  order_id BIGINT NULL,
  telegram_group_id BIGINT NOT NULL,
  telegram_chat_id BIGINT NOT NULL,
  telegram_message_id BIGINT NOT NULL,
  media_group_id VARCHAR(64) NULL,
  file_id VARCHAR(512) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_source_photo_message (telegram_chat_id, telegram_message_id),
  KEY ix_source_photo_order (order_id),
  KEY ix_source_photo_album (telegram_chat_id, media_group_id)
);
