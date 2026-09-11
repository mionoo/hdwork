ALTER TABLE cacti_alarms
  ADD COLUMN last_cacti_check VARCHAR(255) NULL AFTER alarm_status;

CREATE TABLE cacti_collector_health (
  id BIGINT NOT NULL AUTO_INCREMENT,
  collector VARCHAR(100) NOT NULL,
  customer_type VARCHAR(50) NOT NULL,
  last_received_at DATETIME NOT NULL,
  last_ping_host VARCHAR(255) NULL,
  last_ping_reachable TINYINT(1) NULL,
  last_ping_latency_ms INT NULL,
  last_ping_error VARCHAR(255) NULL,
  last_scan_failed_count INT NOT NULL DEFAULT 0,
  last_scan_summary TEXT NULL,
  last_alert_state ENUM('HEALTHY', 'UNHEALTHY') NOT NULL DEFAULT 'HEALTHY',
  last_health_checked_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cacti_collector_health (collector, customer_type),
  KEY idx_cacti_collector_last_received (last_received_at)
);
