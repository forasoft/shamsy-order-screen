-- Trial data from the brief: two users, three invented dealers, four products.
insert into shamsy.users (email, full_name, role, order_prefix, password_hash) values
  ('adviser@shamsy.test', 'Sana (sales adviser)', 'adviser', 'SA', extensions.crypt('Adviser-2026', extensions.gen_salt('bf', 10))),
  ('owner@shamsy.test',   'Owner (approves discounts)',                'owner',   'OW', extensions.crypt('Owner-2026',   extensions.gen_salt('bf', 10)))
on conflict (email) do nothing;

insert into shamsy.settings (id, todays_rate_sdg_per_usd, min_rate_sdg_per_usd, sand_max_bp, red_max_bp)
values (1, 8200, 8000, 300, 500)
on conflict (id) do nothing;

insert into shamsy.customers (name, city)
select * from (values ('Ahmed Trading', 'Khartoum'), ('Nile Solar', 'Omdurman'), ('Dongola Power', 'Dongola')) v(name, city)
where not exists (select 1 from shamsy.customers);

insert into shamsy.products (sku, name, price_usd_cents) values
  ('SPF-6000-ES-PLUS', 'SPF 6000 ES Plus — 6 kW inverter',  51500),
  ('SPE-12000-ES',     'SPE 12000 ES — 12 kW inverter',      97500),
  ('HOPE-5.0L-B1',     'Hope 5.0L-B1 — 5 kWh battery',       81000),
  ('HOPE-16.0LM-A1',   'Hope 16.0LM-A1 — 16 kWh battery',   207000)
on conflict (sku) do nothing;
