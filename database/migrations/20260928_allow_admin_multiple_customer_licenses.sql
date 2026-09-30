-- Allow explicit staff/admin override licences to coexist with a customer's
-- normal current licence while preserving one-current-per-customer/product for
-- ordinary fulfilment.

drop index if exists public.licenses_one_current_customer_product_uidx;

create unique index licenses_one_current_customer_product_uidx
  on public.licenses(product_id, customer_external_id)
  where customer_external_id is not null
    and customer_override = false
    and status not in ('revoked','expired');

create index if not exists licenses_customer_override_lookup_idx
  on public.licenses(customer_external_id, product_id, created_at desc)
  where customer_override = true;
