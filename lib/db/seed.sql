INSERT INTO service_categories (id, name, slug, icon_name, description)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'Appliance repair', 'appliance-repair', 'appliance', 'Fridges, washing machines, cookers and more'),
  ('00000000-0000-0000-0000-000000000002', 'Electrician', 'electrician', 'electric', 'Safe, reliable help for electrical problems'),
  ('00000000-0000-0000-0000-000000000003', 'Plumber', 'plumber', 'plumber', 'Leaks, drains, faucets and installations'),
  ('00000000-0000-0000-0000-000000000004', 'AC & refrigeration', 'ac-refrigeration', 'ac', 'Keep your home cool and comfortable'),
  ('00000000-0000-0000-0000-000000000005', 'Cleaning', 'cleaning', 'cleaning', 'A fresh, cared-for home without the hassle')
ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, icon_name = EXCLUDED.icon_name, description = EXCLUDED.description;

INSERT INTO pricing_rules (category_id, base_price_min, base_price_max, emergency_fee, platform_commission_rate)
SELECT id, CASE slug WHEN 'electrician' THEN 350 ELSE 400 END, CASE slug WHEN 'electrician' THEN 650 WHEN 'cleaning' THEN 1000 ELSE 700 END, 150, 0.15
FROM service_categories
WHERE slug IN ('appliance-repair', 'electrician', 'plumber', 'ac-refrigeration', 'cleaning')
  AND NOT EXISTS (SELECT 1 FROM pricing_rules existing WHERE existing.category_id = service_categories.id);

INSERT INTO homecare_plans (id, name, description, monthly_price, visits_per_month, is_active)
VALUES
  ('00000000-0000-0000-0000-000000000101', 'HomeCare Essential', 'Routine home maintenance with one scheduled visit each month.', 499, 1, TRUE),
  ('00000000-0000-0000-0000-000000000102', 'HomeCare Plus', 'Priority maintenance with two scheduled visits each month.', 899, 2, TRUE)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, monthly_price = EXCLUDED.monthly_price, visits_per_month = EXCLUDED.visits_per_month, is_active = EXCLUDED.is_active;

INSERT INTO promotions (id, code, description, discount_percent, expires_at, is_active)
VALUES ('00000000-0000-0000-0000-000000000201', 'WELCOME10', '10% off your first service.', 10, '2030-01-01T00:00:00Z', TRUE)
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description, discount_percent = EXCLUDED.discount_percent, expires_at = EXCLUDED.expires_at, is_active = EXCLUDED.is_active;
