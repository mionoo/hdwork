ALTER TABLE telegram_groups
  DROP INDEX telegram_chat_id,
  ADD COLUMN telegram_thread_id BIGINT NOT NULL DEFAULT 0 AFTER telegram_chat_id,
  ADD UNIQUE KEY uq_telegram_group_thread (telegram_chat_id, telegram_thread_id);

ALTER TABLE order_results
  ADD COLUMN telegram_thread_id BIGINT NULL AFTER telegram_chat_id;
