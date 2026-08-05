-- 搞笑首页的厕所榜不受当前地图视野限制。
-- 地图列表仍然用 nearby_toilets；这里读全站 published 厕所，按搞笑分和评分排序。

create or replace function top_toilets(p_limit integer default 30)
returns table (
  id uuid, name text, name_en text, voted_name text,
  lat double precision, lng double precision,
  address text, address_en text, building text, floor text,
  gender text, category text,
  has_paper boolean, has_soap boolean, has_dryer boolean, has_hook boolean,
  accessible boolean, baby_changing boolean, seat_type text, stall_count integer,
  is_free boolean, needs_code boolean, open_24h boolean,
  review_count integer,
  avg_clean numeric, avg_queue numeric, avg_smell numeric, avg_privacy numeric,
  source text,
  funny_up integer, funny_down integer, funny_score integer, funny_vote smallint
)
language sql
stable
set search_path = public, extensions
as $$
  select
    t.id, t.name, t.name_en, t.voted_name,
    st_y(t.location::geometry), st_x(t.location::geometry),
    t.address, t.address_en, t.building, t.floor, t.gender, t.category,
    t.has_paper, t.has_soap, t.has_dryer, t.has_hook,
    t.accessible, t.baby_changing, t.seat_type, t.stall_count,
    t.is_free, t.needs_code, t.open_24h,
    t.review_count, t.avg_clean, t.avg_queue, t.avg_smell, t.avg_privacy,
    t.source,
    t.funny_up, t.funny_down, t.funny_score,
    coalesce(v.value, 0)::smallint
  from toilets t
  left join toilet_funny_votes v
    on v.toilet_id = t.id and v.user_id = auth.uid()
  where t.status = 'published'
  order by
    t.funny_score desc,
    (
      coalesce(t.avg_clean, 0)
      + coalesce(t.avg_queue, 0)
      + coalesce(t.avg_smell, 0)
      + coalesce(t.avg_privacy, 0)
    ) desc,
    t.review_count desc,
    t.created_at desc
  limit greatest(least(p_limit, 100), 1);
$$;

grant execute on function top_toilets(integer) to anon, authenticated;
