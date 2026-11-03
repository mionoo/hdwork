ALTER TABLE telegram_groups
  ADD COLUMN workflow ENUM('ASSURANCE', 'PROVISIONING') NULL AFTER category,
  ADD INDEX ix_telegram_room_scope (city_id, segment_id, category);

-- Older installs can have a unique city/segment/category index under different
-- names. Only remove indexes on exactly those three columns; keep chat/topic unique.
SET @room_scope_indexes = (
  SELECT GROUP_CONCAT(CONCAT('DROP INDEX `', REPLACE(index_name, '`', '``'), '`'))
  FROM (
    SELECT index_name FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'telegram_groups'
      AND non_unique = 0 AND index_name <> 'PRIMARY'
    GROUP BY index_name
    HAVING COUNT(*) = 3
      AND GROUP_CONCAT(column_name ORDER BY column_name) = 'category,city_id,segment_id'
  ) AS scope_indexes
);
SET @room_scope_sql = IF(@room_scope_indexes IS NULL, 'SELECT 1',
  CONCAT('ALTER TABLE telegram_groups ', @room_scope_indexes));
PREPARE room_scope_statement FROM @room_scope_sql;
EXECUTE room_scope_statement;
DEALLOCATE PREPARE room_scope_statement;

INSERT INTO segments (code)
SELECT 'REPLACE_ONT'
WHERE NOT EXISTS (SELECT 1 FROM segments WHERE code = 'REPLACE_ONT');
