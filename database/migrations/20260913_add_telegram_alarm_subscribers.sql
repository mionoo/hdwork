-- Subscriber alarm personal dipisahkan dari telegram_groups agar satu user
-- dapat berlangganan DATIN dan/atau NODEB tanpa memengaruhi tujuan grup.
CREATE TABLE telegram_alarm_subscribers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_type VARCHAR(32) NOT NULL,
  telegram_user_id BIGINT NOT NULL,
  telegram_chat_id BIGINT NOT NULL,
  telegram_username VARCHAR(255) NULL,
  display_name VARCHAR(255) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_telegram_alarm_subscriber (customer_type, telegram_user_id),
  KEY idx_telegram_alarm_subscriber_active (customer_type, is_active)
);
