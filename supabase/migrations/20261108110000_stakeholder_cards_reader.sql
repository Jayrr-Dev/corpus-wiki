-- STAKEHOLDER CARDS READ AS THEIR OWNER: the list marks "our organization" from workspace_settings,
-- which signed-in people cannot read directly. The function only reads, so it runs as its owner.
alter function public.stakeholder_cards() security definer;
revoke all on function public.stakeholder_cards() from public, anon;
grant execute on function public.stakeholder_cards() to authenticated, service_role;
