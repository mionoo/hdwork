ALTER TABLE telegram_outbox
  MODIFY COLUMN kind ENUM('result', 'claim', 'reply') NOT NULL;
