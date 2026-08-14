-- إضافة عمود نوع الموقع لجدول عناوين العملاء
ALTER TABLE customer_addresses
  ADD COLUMN location_type VARCHAR(50) NULL DEFAULT NULL;
