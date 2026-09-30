-- Keep exactly one non-terminal license per customer/product.
-- Older duplicate current rows are retained as revoked history.
with ranked as (
  select l.id,
         row_number() over (
           partition by l.product_id, l.customer_external_id
           order by l.created_at desc, l.id desc
         ) as rn
  from licenses l
  where l.customer_external_id is not null
    and l.status not in ('revoked','expired')
)
update licenses l
set status='revoked', updated_at=now()
from ranked r
where l.id=r.id and r.rn>1;

create unique index if not exists licenses_one_current_customer_product_uidx
  on licenses(product_id, customer_external_id)
  where customer_external_id is not null
    and status not in ('revoked','expired');
