ALTER TABLE users
  ADD COLUMN agent_id BIGINT NULL AFTER branch_id,
  ADD INDEX idx_users_agent_id (agent_id);

ALTER TABLE users
  ADD CONSTRAINT fk_users_agent_id
  FOREIGN KEY (agent_id) REFERENCES agents(id)
  ON DELETE SET NULL
  ON UPDATE CASCADE;