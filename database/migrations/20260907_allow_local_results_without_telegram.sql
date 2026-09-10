ALTER TABLE order_results
  MODIFY telegram_chat_id BIGINT NULL,
  MODIFY telegram_message_id BIGINT NULL;
