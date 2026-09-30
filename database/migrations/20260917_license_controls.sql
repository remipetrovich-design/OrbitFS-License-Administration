-- License / installation control expansion.
alter table if exists activations add column if not exists status text not null default 'active';
alter table if exists activations drop constraint if exists activations_status_check;
alter table if exists activations add constraint activations_status_check check(status in ('active','locked','terminated'));
create index if not exists activations_status_idx on activations(status);
create index if not exists activations_seen_idx on activations(last_seen_at desc);

-- Explicitly distinguish Billing Store customer numbers from administrative overrides.
alter table if exists licenses add column if not exists customer_override boolean not null default false;
create index if not exists licenses_override_idx on licenses(customer_override);
