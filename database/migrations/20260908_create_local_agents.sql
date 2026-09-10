CREATE TABLE local_agents (
  id BIGINT NOT NULL AUTO_INCREMENT,
  agent_key CHAR(36) NOT NULL,
  user_id BIGINT NOT NULL,
  name VARCHAR(100) NOT NULL,
  token_hash CHAR(64) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  last_seen_at DATETIME NULL,
  connected_at DATETIME NULL,
  disconnected_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_local_agents_agent_key (agent_key),
  KEY idx_local_agents_user_id (user_id),
  CONSTRAINT fk_local_agents_user FOREIGN KEY (user_id) REFERENCES users(id)
);
