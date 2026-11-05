-- Remove account attribution without deleting shared order history or results.
ALTER TABLE order_assignments MODIFY COLUMN user_id BIGINT NULL;
ALTER TABLE order_notes MODIFY COLUMN user_id BIGINT NULL;
ALTER TABLE order_results MODIFY COLUMN user_id BIGINT NULL;
