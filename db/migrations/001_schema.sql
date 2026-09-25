-- Shamsy order screen — schema and business rules.
--
-- The rules live here, in the database, so that no client can bypass them:
-- not the screen, not a direct call to the API, not a SQL session.
--
--   * prices are fixed: a line's unit price must equal the catalogue price
--   * discount bands are computed here from the settings, never trusted from a client
--   * a line above the upper band cannot be stored without an approval by an owner,
--     and only an owner who is the acting user can record that approval
--   * the order's rate can never be below the minimum rate
--   * the rate is stored on the order; saved orders and their lines never change
--
-- Money is stored as whole numbers: US dollars in cents, Sudanese pounds in piastres.
-- The acting user is passed per transaction with set_config('app.actor_id', ..., true).

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists shamsy;

-- ---------------------------------------------------------------- tables

create table shamsy.users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  full_name     text not null,
  role          text not null check (role in ('owner', 'adviser')),
  order_prefix  text check (order_prefix ~ '^[A-Z]{2,4}$'),
  password_hash text not null,
  created_at    timestamptz not null default now()
);

create table shamsy.settings (
  id                       integer primary key default 1 check (id = 1),
  todays_rate_sdg_per_usd  integer not null check (todays_rate_sdg_per_usd > 0),
  min_rate_sdg_per_usd     integer not null check (min_rate_sdg_per_usd > 0),
  sand_max_bp              integer not null default 300,   -- up to 3.00 %  -> sand
  red_max_bp               integer not null default 500,   -- up to 5.00 %  -> red; above -> blocked
  updated_by               uuid references shamsy.users (id),
  updated_at               timestamptz not null default now(),
  check (todays_rate_sdg_per_usd >= min_rate_sdg_per_usd),
  check (sand_max_bp > 0 and sand_max_bp <= red_max_bp and red_max_bp < 10000)
);

create table shamsy.settings_log (
  id          bigserial primary key,
  changed_at  timestamptz not null default now(),
  changed_by  uuid references shamsy.users (id),
  old_values  jsonb not null,
  new_values  jsonb not null
);

create table shamsy.customers (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  city       text not null,
  created_at timestamptz not null default now()
);

create table shamsy.products (
  id               uuid primary key default gen_random_uuid(),
  sku              text not null unique,
  name             text not null,
  price_usd_cents  bigint not null check (price_usd_cents > 0),
  active           boolean not null default true,
  updated_by       uuid references shamsy.users (id),
  updated_at       timestamptz not null default now()
);

create table shamsy.product_price_log (
  id              bigserial primary key,
  product_id      uuid not null references shamsy.products (id),
  old_price_cents bigint not null,
  new_price_cents bigint not null,
  changed_by      uuid references shamsy.users (id),
  changed_at      timestamptz not null default now()
);

create table shamsy.order_counters (
  prefix text primary key,
  last   integer not null
);

create table shamsy.orders (
  id                     uuid primary key,          -- generated on the phone: the idempotency key
  order_number           text not null unique,
  customer_id            uuid not null references shamsy.customers (id),
  adviser_id             uuid not null references shamsy.users (id),
  saved_by               uuid not null references shamsy.users (id),
  rate_sdg_per_usd       integer not null check (rate_sdg_per_usd > 0),
  total_usd_cents        bigint not null check (total_usd_cents >= 0),
  total_sdg_piastres     bigint not null check (total_sdg_piastres >= 0),
  created_on_device_at   timestamptz,
  saved_at               timestamptz not null default now(),
  created_xact           xid8 not null default pg_current_xact_id()
);

create table shamsy.order_lines (
  order_id              uuid not null references shamsy.orders (id),
  line_no               smallint not null check (line_no between 1 and 200),
  product_id            uuid not null references shamsy.products (id),
  quantity              integer not null check (quantity between 1 and 100000),
  unit_price_usd_cents  bigint not null,
  line_value_usd_cents  bigint not null,
  discount_usd_cents    bigint not null check (discount_usd_cents >= 0),
  discount_bp           integer not null,   -- discount as basis points of line value, rounded, for display
  band                  text not null check (band in ('none', 'sand', 'red', 'blocked')),
  line_total_usd_cents  bigint not null,
  approved_by           uuid references shamsy.users (id),
  approved_at           timestamptz,
  primary key (order_id, line_no)
);

create table shamsy.approval_requests (
  id                uuid primary key,
  requested_by      uuid not null references shamsy.users (id),
  customer_id       uuid not null references shamsy.customers (id),
  rate_sdg_per_usd  integer not null check (rate_sdg_per_usd > 0),
  lines             jsonb not null,
  status            text not null default 'pending' check (status in ('pending', 'approved')),
  decided_by        uuid references shamsy.users (id),
  decided_at        timestamptz,
  order_id          uuid references shamsy.orders (id),
  created_at        timestamptz not null default now()
);

create index on shamsy.orders (adviser_id, saved_at desc);
create index on shamsy.approval_requests (status, created_at desc);

-- ---------------------------------------------------------------- helpers

-- The user acting in this transaction. Every write must name one.
create or replace function shamsy.actor() returns shamsy.users
language plpgsql stable as $$
declare
  v_id text := current_setting('app.actor_id', true);
  v_user shamsy.users;
begin
  if v_id is null or v_id = '' then
    raise exception 'NO_ACTOR' using detail = 'Every write must run as a known user.';
  end if;
  select * into v_user from shamsy.users where id = v_id::uuid;
  if not found then
    raise exception 'NO_ACTOR' using detail = 'The acting user does not exist.';
  end if;
  return v_user;
end $$;

-- Discount band for a line, from the thresholds in the settings. Integer arithmetic only.
create or replace function shamsy.discount_band(p_discount bigint, p_value bigint)
returns text language sql stable as $$
  select case
    when p_discount = 0 then 'none'
    when p_discount * 10000 <= p_value * s.sand_max_bp then 'sand'
    when p_discount * 10000 <= p_value * s.red_max_bp then 'red'
    else 'blocked'
  end
  from shamsy.settings s where s.id = 1
$$;

create or replace function shamsy.next_order_number(p_prefix text) returns text
language plpgsql as $$
declare v_last integer;
begin
  insert into shamsy.order_counters (prefix, last) values (p_prefix, 1)
  on conflict (prefix) do update set last = shamsy.order_counters.last + 1
  returning last into v_last;
  return p_prefix || '-' || lpad(v_last::text, 4, '0');
end $$;

-- ---------------------------------------------------------------- rules on order lines

create or replace function shamsy.order_lines_before_insert() returns trigger
language plpgsql as $$
declare
  v_actor    shamsy.users := shamsy.actor();
  v_price    bigint;
  v_xact     xid8;
  v_approver shamsy.users;
begin
  -- lines can only be written together with their order, in the same transaction
  select created_xact into v_xact from shamsy.orders where id = new.order_id;
  if v_xact is distinct from pg_current_xact_id() then
    raise exception 'SAVED_ORDER_IS_IMMUTABLE' using detail = 'Lines cannot be added to an order that is already saved.';
  end if;

  -- prices are fixed: the unit price must be the catalogue price
  select price_usd_cents into v_price from shamsy.products where id = new.product_id and active;
  if v_price is null then
    raise exception 'UNKNOWN_PRODUCT' using detail = format('Product %s is not in the catalogue.', new.product_id);
  end if;
  if new.unit_price_usd_cents is distinct from v_price then
    raise exception 'PRICE_IS_FIXED' using detail = format(
      'Line %s: unit price %s cents does not match the catalogue price %s cents.',
      new.line_no, new.unit_price_usd_cents, v_price);
  end if;

  -- everything derived is computed here, never taken from the client
  new.line_value_usd_cents := new.unit_price_usd_cents * new.quantity;
  if new.discount_usd_cents > new.line_value_usd_cents then
    raise exception 'DISCOUNT_EXCEEDS_LINE' using detail = format('Line %s: the discount is larger than the line value.', new.line_no);
  end if;
  new.discount_bp := round(new.discount_usd_cents * 10000.0 / new.line_value_usd_cents)::integer;
  new.band := shamsy.discount_band(new.discount_usd_cents, new.line_value_usd_cents);
  new.line_total_usd_cents := new.line_value_usd_cents - new.discount_usd_cents;

  -- above the upper band: only with an approval, and only an owner can approve
  if new.band = 'blocked' then
    if new.approved_by is null then
      raise exception 'DISCOUNT_NEEDS_OWNER_APPROVAL' using detail = format(
        'Line %s: a discount of %s%% is above the limit and needs the owner''s approval.',
        new.line_no, to_char(new.discount_bp / 100.0, 'FM990.00'));
    end if;
    select * into v_approver from shamsy.users where id = new.approved_by;
    if v_approver.role is distinct from 'owner' or new.approved_by <> v_actor.id then
      raise exception 'APPROVAL_ONLY_BY_OWNER' using detail = format(
        'Line %s: only the owner, acting as themselves, can approve this discount.', new.line_no);
    end if;
    new.approved_at := now();
  else
    new.approved_by := null;
    new.approved_at := null;
  end if;

  return new;
end $$;

create trigger order_lines_rules before insert on shamsy.order_lines
  for each row execute function shamsy.order_lines_before_insert();

-- ---------------------------------------------------------------- rules on orders

create or replace function shamsy.orders_before_insert() returns trigger
language plpgsql as $$
declare
  v_actor shamsy.users := shamsy.actor();
  v_min   integer;
begin
  select min_rate_sdg_per_usd into v_min from shamsy.settings where id = 1;
  if new.rate_sdg_per_usd < v_min then
    raise exception 'RATE_BELOW_MINIMUM' using detail = format(
      'The rate %s is below the minimum of %s SDG per USD.', new.rate_sdg_per_usd, v_min);
  end if;
  if v_actor.role = 'adviser' and new.adviser_id <> v_actor.id then
    raise exception 'NOT_YOUR_ORDER' using detail = 'An adviser can only save her own orders.';
  end if;
  new.saved_by := v_actor.id;
  new.saved_at := now();
  new.created_xact := pg_current_xact_id();
  return new;
end $$;

create trigger orders_rules before insert on shamsy.orders
  for each row execute function shamsy.orders_before_insert();

-- At commit: the order has lines, and its stored totals are exactly the sum of its lines.
create or replace function shamsy.orders_check_totals() returns trigger
language plpgsql as $$
declare
  v_lines integer;
  v_usd   bigint;
begin
  select count(*), coalesce(sum(line_total_usd_cents), 0) into v_lines, v_usd
  from shamsy.order_lines where order_id = new.id;
  if v_lines = 0 then
    raise exception 'ORDER_WITHOUT_LINES' using detail = 'An order needs at least one line.';
  end if;
  if new.total_usd_cents <> v_usd or new.total_sdg_piastres <> v_usd * new.rate_sdg_per_usd then
    raise exception 'TOTALS_DO_NOT_MATCH' using detail = format(
      'Stored totals %s cents / %s piastres; the lines give %s cents / %s piastres.',
      new.total_usd_cents, new.total_sdg_piastres, v_usd, v_usd * new.rate_sdg_per_usd);
  end if;
  return null;
end $$;

create constraint trigger orders_totals after insert on shamsy.orders
  deferrable initially deferred
  for each row execute function shamsy.orders_check_totals();

-- A saved order never changes.
create or replace function shamsy.forbid_change() returns trigger
language plpgsql as $$
begin
  raise exception 'SAVED_ORDER_IS_IMMUTABLE' using detail = 'A saved order and its lines never change.';
end $$;

create trigger orders_immutable before update or delete on shamsy.orders
  for each row execute function shamsy.forbid_change();
create trigger order_lines_immutable before update or delete on shamsy.order_lines
  for each row execute function shamsy.forbid_change();

-- ---------------------------------------------------------------- owner-only changes

create or replace function shamsy.settings_before_update() returns trigger
language plpgsql as $$
declare v_actor shamsy.users := shamsy.actor();
begin
  if v_actor.role <> 'owner' then
    raise exception 'OWNER_ONLY' using detail = 'Only the owner can change the settings.';
  end if;
  new.updated_by := v_actor.id;
  new.updated_at := now();
  insert into shamsy.settings_log (changed_by, old_values, new_values)
  values (v_actor.id, to_jsonb(old) - 'updated_at' - 'updated_by', to_jsonb(new) - 'updated_at' - 'updated_by');
  return new;
end $$;

create trigger settings_rules before update on shamsy.settings
  for each row execute function shamsy.settings_before_update();

create or replace function shamsy.products_before_update() returns trigger
language plpgsql as $$
declare v_actor shamsy.users := shamsy.actor();
begin
  if v_actor.role <> 'owner' then
    raise exception 'OWNER_ONLY' using detail = 'Only the owner can change a price.';
  end if;
  if new.price_usd_cents is distinct from old.price_usd_cents then
    insert into shamsy.product_price_log (product_id, old_price_cents, new_price_cents, changed_by)
    values (old.id, old.price_usd_cents, new.price_usd_cents, v_actor.id);
  end if;
  new.updated_by := v_actor.id;
  new.updated_at := now();
  return new;
end $$;

create trigger products_rules before update on shamsy.products
  for each row execute function shamsy.products_before_update();

create or replace function shamsy.approval_requests_rules() returns trigger
language plpgsql as $$
declare v_actor shamsy.users := shamsy.actor();
begin
  if tg_op = 'INSERT' then
    new.requested_by := v_actor.id;
    new.status := 'pending';
    new.decided_by := null; new.decided_at := null; new.order_id := null;
    return new;
  end if;
  if old.status <> 'pending' then
    raise exception 'REQUEST_ALREADY_DECIDED' using detail = 'This approval request has already been decided.';
  end if;
  if v_actor.role <> 'owner' then
    raise exception 'OWNER_ONLY' using detail = 'Only the owner can decide an approval request.';
  end if;
  new.decided_by := v_actor.id;
  new.decided_at := now();
  return new;
end $$;

create trigger approval_requests_rules before insert or update on shamsy.approval_requests
  for each row execute function shamsy.approval_requests_rules();

-- The tables are reached only through the application's server. On Supabase the
-- schema is not exposed to the public REST roles.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema shamsy from anon, authenticated';
    execute 'revoke all on all tables in schema shamsy from anon, authenticated';
  end if;
end $$;
