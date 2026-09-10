-- Alarm Cacti bersifat global: tidak terkait kota atau segmen order.
-- Tipe kolom dipertahankan dari schema yang sudah ada agar tetap aman
-- terhadap foreign key cities dan segments.
SET @city_id_type = (
  SELECT COLUMN_TYPE
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'telegram_groups'
    AND COLUMN_NAME = 'city_id'
);

SET @segment_id_type = (
  SELECT COLUMN_TYPE
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'telegram_groups'
    AND COLUMN_NAME = 'segment_id'
);

SET @alarm_groups_sql = CONCAT(
  'ALTER TABLE telegram_groups ',
  'MODIFY COLUMN city_id ', @city_id_type, ' NULL, ',
  'MODIFY COLUMN segment_id ', @segment_id_type, ' NULL'
);

PREPARE alarm_groups_statement FROM @alarm_groups_sql;
EXECUTE alarm_groups_statement;
DEALLOCATE PREPARE alarm_groups_statement;
