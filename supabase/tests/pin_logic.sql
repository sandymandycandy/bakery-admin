-- Chef PIN sign-in on kitchen tablets (Phase 5D). Runs in a transaction and rolls back.
-- Expected outcomes are in the comment above each check.
begin;
create temp table r (n serial, check_name text, outcome text) on commit drop;
create temp table ctx (k text primary key, v text) on commit drop;
grant all on r, ctx to authenticated, service_role;
grant usage on sequence r_n_seq to authenticated, service_role;

insert into auth.users (id, email, aud, role) values
 ('00000000-0000-0000-0000-000000000ba1','pn-a@t.local','authenticated','authenticated'),
 ('00000000-0000-0000-0000-000000000bc1','pn-c@t.local','authenticated','authenticated'),
 ('00000000-0000-0000-0000-000000000bf1','pn-f1@t.local','authenticated','authenticated'),
 ('00000000-0000-0000-0000-000000000bf2','pn-f2@t.local','authenticated','authenticated'),
 ('00000000-0000-0000-0000-000000000bf3','pn-f3@t.local','authenticated','authenticated');
insert into public.staff_profiles (user_id, full_name, role, is_active) values
 ('00000000-0000-0000-0000-000000000ba1','Pn Admin','admin', true),
 ('00000000-0000-0000-0000-000000000bc1','Pn Counter','counter', true),
 ('00000000-0000-0000-0000-000000000bf1','Pn Chef One','chef', true),
 ('00000000-0000-0000-0000-000000000bf2','Pn Chef Two','chef', true),
 ('00000000-0000-0000-0000-000000000bf3','Pn Chef Gone','chef', true);
insert into public.kitchens (code, name) values ('TP1', 'T Pin Kitchen One'), ('TP2', 'T Pin Kitchen Two');
insert into public.staff_kitchens (user_id, kitchen_id)
  select '00000000-0000-0000-0000-000000000bf1'::uuid, id from public.kitchens where code = 'TP1';
insert into public.staff_kitchens (user_id, kitchen_id)
  select '00000000-0000-0000-0000-000000000bf2'::uuid, id from public.kitchens where code = 'TP2';
insert into public.staff_kitchens (user_id, kitchen_id)
  select '00000000-0000-0000-0000-000000000bf3'::uuid, id from public.kitchens where code = 'TP1';
insert into ctx select 'K1', id::text from public.kitchens where code = 'TP1';
-- Two tablet tokens' hashes (any 64 hex characters).
insert into ctx values ('H1', repeat('a1', 32)), ('H2', repeat('b2', 32));

create function pg_temp.verify(p_hash text, p_user text, p_pin text) returns text language sql as $$
  select case when (x ->> 'ok')::boolean
              then 'ok ' || ((x ->> 'kitchen_id') = (select v from ctx where k = 'K1'))::text
              else 'refused' end
  from (select public.verify_kitchen_pin(p_hash, p_user::uuid, p_pin) as x) y
$$;

set local role authenticated;

-- ===== Setting PINs and registering tablets =====
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000bc1","role":"authenticated"}', true);
do $$
declare h text;
begin
  begin perform public.set_staff_pin('00000000-0000-0000-0000-000000000bf1', '1234');
    insert into r(check_name,outcome) values ('P1 counter staff cannot set PINs', 'ALLOWED');
  -- expect: forbidden: Only an admin can set PINs.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('P1 counter staff cannot set PINs', h || ': ' || sqlerrm); end;
  begin perform public.register_kitchen_device((select v::uuid from ctx where k = 'K1'), 'Counter tablet', (select v from ctx where k = 'H2'));
    insert into r(check_name,outcome) values ('P2 counter staff cannot register tablets', 'ALLOWED');
  -- expect: forbidden: Only an admin can register kitchen tablets.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('P2 counter staff cannot register tablets', h || ': ' || sqlerrm); end;
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000ba1","role":"authenticated"}', true);
do $$
declare h text; bad text;
begin
  foreach bad in array array['123', '1234567', '12a4', ' 1234'] loop
    begin perform public.set_staff_pin('00000000-0000-0000-0000-000000000bf1', bad);
      insert into r(check_name,outcome) values ('P3 a PIN is 4 to 6 digits: ' || bad, 'ALLOWED');
    exception when others then insert into r(check_name,outcome) values ('P3 a PIN is 4 to 6 digits: ' || bad, sqlerrm); end;
  end loop;
  begin perform public.set_staff_pin('00000000-0000-0000-0000-000000000bc1', '1234');
    insert into r(check_name,outcome) values ('P4 PINs are only for chefs', 'ALLOWED');
  -- expect: PINs are only for chefs.
  exception when others then insert into r(check_name,outcome) values ('P4 PINs are only for chefs', sqlerrm); end;

  perform public.set_staff_pin('00000000-0000-0000-0000-000000000bf1', '1234');
  perform public.set_staff_pin('00000000-0000-0000-0000-000000000bf2', '5678');
  perform public.set_staff_pin('00000000-0000-0000-0000-000000000bf3', '0000');
  insert into ctx select 'D1', public.register_kitchen_device((select v::uuid from ctx where k = 'K1'), ' Kitchen One tablet ', (select v from ctx where k = 'H1'))::text;
  -- expect: Kitchen One tablet / 0
  insert into r(check_name,outcome) values ('P5 admin registers a tablet for a kitchen',
    (select label || ' / ' || failed_pins from public.kitchen_devices where id = (select v::uuid from ctx where k = 'D1')));
  begin perform public.register_kitchen_device((select v::uuid from ctx where k = 'K1'), 'Bad', 'not-a-hash');
    insert into r(check_name,outcome) values ('P6 the device token hash is checked', 'ALLOWED');
  -- expect: Invalid tablet token.
  exception when others then insert into r(check_name,outcome) values ('P6 the device token hash is checked', sqlerrm); end;
  -- expect: UPDATE / false
  insert into r(check_name,outcome) values ('P7 PIN changes are audited without the hash',
    (select string_agg(distinct action, ',') from public.audit_events where table_name = 'staff_pins') || ' / '
    || exists (select 1 from public.audit_events where table_name = 'staff_pins'
               and (coalesce(old_data, '{}') ? 'pin_hash' or coalesce(new_data, '{}') ? 'pin_hash'))::text);
end $$;

-- Chef Gone leaves.
reset role;
update public.staff_profiles set is_active = false where user_id = '00000000-0000-0000-0000-000000000bf3';

-- ===== Staff cannot read PINs or call the tablet functions =====
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000ba1","role":"authenticated"}', true);
do $$
declare h text;
begin
  begin perform 1 from public.staff_pins;
    insert into r(check_name,outcome) values ('P8 not even an admin can read PIN hashes', 'ALLOWED');
  -- expect: permission denied for table staff_pins
  exception when others then insert into r(check_name,outcome) values ('P8 not even an admin can read PIN hashes', sqlerrm); end;
  begin perform public.verify_kitchen_pin((select v from ctx where k = 'H1'), '00000000-0000-0000-0000-000000000bf1', '1234');
    insert into r(check_name,outcome) values ('P9 signed-in staff cannot check PINs directly', 'ALLOWED');
  -- expect: permission denied for function verify_kitchen_pin
  exception when others then insert into r(check_name,outcome) values ('P9 signed-in staff cannot check PINs directly', sqlerrm); end;
end $$;

-- ===== The tablet's server (service role) =====
reset role;
set local role service_role;
do $$
declare h1 text := (select v from ctx where k = 'H1'); x jsonb; got text;
begin
  -- expect: ok true
  insert into r(check_name,outcome) values ('P10 the right PIN on a registered tablet of the chef''s kitchen',
    pg_temp.verify(h1, '00000000-0000-0000-0000-000000000bf1', '1234'));
  x := public.verify_kitchen_pin(h1, '00000000-0000-0000-0000-000000000bf1', '1234');
  -- expect: true / true
  insert into r(check_name,outcome) values ('P10b the answer carries the database sign-in time, valid for the session check',
    ((x ->> 'signed_in_at')::timestamptz = now())::text || ' / '
    || public.kitchen_pin_session_valid(h1, '00000000-0000-0000-0000-000000000bf1', (x ->> 'signed_in_at')::timestamptz)::text);
  -- (Each check runs first, then the count is read in its own statement, after the update.)
  got := pg_temp.verify(h1, '00000000-0000-0000-0000-000000000bf1', '4321');
  -- expect: refused / 1
  insert into r(check_name,outcome) values ('P11 a wrong PIN is refused and counted',
    got || ' / ' || (select failed_pins from public.kitchen_devices where token_hash = h1));
  got := pg_temp.verify(h1, '00000000-0000-0000-0000-000000000bf1', '1234');
  -- expect: ok true / 0 / true
  insert into r(check_name,outcome) values ('P12 a later success resets the count and records the time',
    got || ' / ' || (select failed_pins || ' / ' || (last_used_at is not null)::text from public.kitchen_devices where token_hash = h1));
  -- expect: refused / refused / refused
  insert into r(check_name,outcome) values ('P13 other kitchen''s chef, inactive chef, unknown tablet',
    pg_temp.verify(h1, '00000000-0000-0000-0000-000000000bf2', '5678') || ' / '
    || pg_temp.verify(h1, '00000000-0000-0000-0000-000000000bf3', '0000') || ' / '
    || pg_temp.verify((select v from ctx where k = 'H2'), '00000000-0000-0000-0000-000000000bf1', '1234'));
  x := public.kitchen_device_chefs(h1);
  -- expect: T Pin Kitchen One / Pn Chef One:true
  insert into r(check_name,outcome) values ('P14 the tablet lists the active chefs of its kitchen',
    (x -> 'kitchen' ->> 'name') || ' / '
    || (select string_agg((c ->> 'full_name') || ':' || (c ->> 'has_pin'), ', ') from jsonb_array_elements(x -> 'chefs') c));
  -- expect: true / false
  insert into r(check_name,outcome) values ('P15 a session is valid until the PIN changes',
    public.kitchen_pin_session_valid(h1, '00000000-0000-0000-0000-000000000bf1', now() + interval '1 second')::text || ' / '
    || public.kitchen_pin_session_valid(h1, '00000000-0000-0000-0000-000000000bf1', now() - interval '1 minute')::text);
end $$;

-- Admin clears Chef Two's PIN and revokes the tablet.
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000ba1","role":"authenticated"}', true);
do $$
begin
  perform public.set_staff_pin('00000000-0000-0000-0000-000000000bf1', null);
  -- expect: DELETE,UPDATE
  insert into r(check_name,outcome) values ('P16 clearing a PIN is audited',
    (select string_agg(distinct action, ',' order by action) from public.audit_events where table_name = 'staff_pins'));
  perform public.set_staff_pin('00000000-0000-0000-0000-000000000bf1', '2468');
  perform public.revoke_kitchen_device((select v::uuid from ctx where k = 'D1'));
end $$;

reset role;
set local role service_role;
do $$
declare h1 text := (select v from ctx where k = 'H1');
begin
  -- expect: refused / null / false
  insert into r(check_name,outcome) values ('P17 a revoked tablet takes no PINs, lists no chefs, ends sessions',
    pg_temp.verify(h1, '00000000-0000-0000-0000-000000000bf1', '2468') || ' / '
    || coalesce(public.kitchen_device_chefs(h1)::text, 'null') || ' / '
    || public.kitchen_pin_session_valid(h1, '00000000-0000-0000-0000-000000000bf1', now() + interval '1 second')::text);
end $$;

reset role;
select check_name, outcome from r order by n;
rollback;
