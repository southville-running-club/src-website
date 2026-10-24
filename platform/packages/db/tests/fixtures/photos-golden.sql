-- Race photos for nn-2026, part 1 of 1: NN26-0001 to NN26-0006.
-- Written by photos upload at 2026-11-01T20:00:00.000Z.
--
-- Run the whole of this file in the Supabase SQL editor. Running it again changes
-- nothing, and it never overwrites a decision made on the website or a photo taken
-- down there. The parts can be run in any order.

begin;

insert into photos.event (slug) values ('nn-2026') on conflict (slug) do nothing;

insert into photos.photo
  (id, event_slug, short_id, photographer, spot, taken_at, burst_id, width, height, check_state)
values
  ('00000000-0000-4000-8000-000000000001', 'nn-2026', 'NN26-0001', 'Adrian', 'Finish', '2026-11-01T11:00:05.000Z', 'NN26-0001', 2400, 1600, 'tagged'),
  ('00000000-0000-4000-8000-000000000002', 'nn-2026', 'NN26-0002', 'Adrian', 'Finish', '2026-11-01T11:00:06.000Z', 'NN26-0001', 2400, 1600, 'part_read'),
  ('00000000-0000-4000-8000-000000000003', 'nn-2026', 'NN26-0003', 'Ross O''Neill', 'On the course', null, null, 2400, 1600, 'checked'),
  ('00000000-0000-4000-8000-000000000004', 'nn-2026', 'NN26-0004', 'Ross O''Neill', 'On the course', '2026-11-01T11:20:00.000Z', null, 2400, 1600, 'no_bib_seen'),
  ('00000000-0000-4000-8000-000000000006', 'nn-2026', 'NN26-0006', 'Ross O''Neill', 'On the course', '2026-11-01T11:22:00.000Z', null, 2400, 1600, 'needs_check')
on conflict (id) do update set
  photographer = excluded.photographer,
  spot = excluded.spot,
  taken_at = excluded.taken_at,
  burst_id = excluded.burst_id,
  width = excluded.width,
  height = excluded.height,
  check_state = case when photos.photo.checked_by is null
                     then excluded.check_state else photos.photo.check_state end,
  updated_at = now()
where (photos.photo.photographer, photos.photo.spot, photos.photo.taken_at,
       photos.photo.burst_id, photos.photo.width, photos.photo.height,
       photos.photo.check_state)
      is distinct from
      (excluded.photographer, excluded.spot, excluded.taken_at,
       excluded.burst_id, excluded.width, excluded.height,
       case when photos.photo.checked_by is null
            then excluded.check_state else photos.photo.check_state end);

-- Bib rows the laptop no longer has, unless a checker decided them on the website.
delete from photos.photo_bib b
 where b.photo_id in ('00000000-0000-4000-8000-000000000001'::uuid, '00000000-0000-4000-8000-000000000002'::uuid, '00000000-0000-4000-8000-000000000003'::uuid, '00000000-0000-4000-8000-000000000004'::uuid, '00000000-0000-4000-8000-000000000006'::uuid)
   and b.decided_by is null
   and (b.photo_id, b.bib_text) not in (
    ('00000000-0000-4000-8000-000000000001'::uuid, '0311'),
    ('00000000-0000-4000-8000-000000000002'::uuid, '12?'),
    ('00000000-0000-4000-8000-000000000003'::uuid, '125'),
    ('00000000-0000-4000-8000-000000000006'::uuid, '999')
   );

insert into photos.photo_bib
  (photo_id, bib_text, confidence, confirmed, source, decided_at)
values
  ('00000000-0000-4000-8000-000000000001'::uuid, '0311', 0.970, true, 'model', null::timestamptz),
  ('00000000-0000-4000-8000-000000000002'::uuid, '12?', 0.950, false, 'model', null::timestamptz),
  ('00000000-0000-4000-8000-000000000003'::uuid, '125', 0.500, true, 'person', '2026-11-01T19:30:00.000Z'::timestamptz),
  ('00000000-0000-4000-8000-000000000006'::uuid, '999', 0.990, false, 'model', null::timestamptz)
on conflict (photo_id, bib_text) do update set
  confidence = excluded.confidence,
  confirmed = excluded.confirmed,
  source = excluded.source,
  decided_at = excluded.decided_at
where photos.photo_bib.decided_by is null
  and (photos.photo_bib.confidence, photos.photo_bib.confirmed,
       photos.photo_bib.source, photos.photo_bib.decided_at)
      is distinct from
      (excluded.confidence, excluded.confirmed, excluded.source, excluded.decided_at);

commit;
