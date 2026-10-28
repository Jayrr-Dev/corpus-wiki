# Stakeholder Power Model

The algorithm behind each stakeholder's Power Level (1 to 5). It is the one
source of truth for `lib/stakeholders/power.ts`; change this file first, then
the code. It gives a baseline estimate, not a verdict. Code computes it from
facts; the AI only finds the facts (claim structure labels, card facts).

Inputs: stakeholder cards (`StakeholderCard`), relations (`StructureRelation`,
see `lib/stakeholders/structure.ts`), our organization's id (or null), and `now`.

Who gets a level: every stakeholder except roles (a job like "inspector" is a
seat, not a party) and places that are not jurisdictions. A place whose kind is
a country, province, state, territory, city or municipality counts as a
government; "Edmonton, Alberta" as a plain place does not. Roles and plain
places still count as links in the graph; they just get no level.

Units: power is measured in **staff-equivalents**, roughly "how many people's
worth of resources this controls". Levels are powers of ten of that number.

## 1. Time weight of a link

Every relation gets a time weight `t`:

- Current, and `asOf` within 3 years of `now` (or no `asOf`): `t = 1`.
- Current, but `asOf` older than 3 years: `t = 0.85`, result marked estimated.
- Former (`current` false): `t = max(0.2, 0.5 × 0.5^(yearsSinceUntil / 5))`.
  No `until`: `t = 0.2`.

Former is always below 1, so with everything else equal the current holder
always beats the former holder.

## 2. Own mass of a box

A box is any company, organization, government body or team. Its own mass `M`
comes from the card's `keyFacts` and `web.facts`, taking the largest of:

- employees or staff: as is
- revenue, budget or total assets: amount / 200,000 (dollars; parse "1.2 billion", "$3B", "12,000")
- population (a government body's jurisdiction): population / 50

No number found: a default, and the result is marked estimated.

- national or federal government: 100,000
- provincial or state government: 30,000
- municipal government: 5,000
- other government body or regulator: 2,000
- company: 200
- other organization: 100
- team: 20

## 3. Box power

Inside links between boxes form a tree. Each box has one **main parent**:
the owner with the biggest share, else its `part_of` parent. Other parents
still count as owners below.

First cut cycles. For each ownership cycle, drop the one edge that closes it
(the lowest share, then the lowest id). Every other edge counts as written.
`reports_to` cycles are cut the same way. Then repeat the passes below until
nothing changes by more than 0.1 percent, at most 20 times:

1. **Top down.** A box with no own number gets `share × P(parent)`. Share is
   the staff ratio, taken only from a `part_of` main parent with both numbers
   known, and capped at 1. Otherwise the share is 0.3. A box under an owner
   that has its own number keeps it.
2. **Bottom up.** A parent is at least the sum of its `part_of` children's
   own, fact-based mass `M`. It never uses power the children got from the
   parent, because that would feed on itself.
3. **Owners.** An owner (box or person) gets `share × P(owned) × t` for each
   thing it owns. An unknown share counts as 0.5. An owner with 50 percent or
   more controls it, and gets at least `1.1 × P(owned)`. That way the top owner
   always ranks above what it owns.
4. **Pressure.** A box gains `0.1 × P(target)` for each `regulates` link,
   `0.1 ×` for each `funds` link and `0.05 ×` for each `contracts_with` link
   (the client over the supplier), each times `t`.

## 4. Person power

A person's power has three parts: seats, network and experience.

**Seats.** Each seat `s` gives `v = P(box) × w × t`, where `w` is:

- `leads`: 0.5
- `board_member_of`: 0.2
- `owned_by` (the person owns the box): the share, or 1.1 if 50 percent or more
- `works_in`: by seniority. vice_president 0.2, director 0.1, manager 0.04,
  lead 0.02, staff 0.005, entry 0.002, advisor 0.01, unknown 0.01. The
  seniorities executive, top_official, elected_leader and owner count as
  `leads`. The seniorities board and elected_member count as `board_member_of`.

A person known only through the card's `person.organizationEntityId` counts as
`works_in` that box, with seniority from their title when it is obvious.

`Seats = biggest v + 0.3 × (sum of the other v)`

**Reports to.** A boss is at least `1.1 ×` each current direct report.

**Network.** List every box or person they are linked to by any seat, current
or former, plus their `reports_to` people. Weigh each by its power times `t`,
and sort from biggest to smallest:

`Network = 0.1 × (sum over k of P_k × t_k / k)`

This is capped at half the untimed value of their biggest seat. Dividing by
the rank `k` makes many small links worth less than one big link.

**Experience.** `peak` is the rank of the highest seniority they ever held,
where the top of the ladder is 1 and the bottom is 0. `years` is the total
years in seats, from `since` and `until` when known.

`X = min(0.25, 0.1 × peak + 0.01 × years)`

`Person = (Seats + Network) × (1 + X)`

The leftover from one former seat (its `v`) never beats the current holder of
that seat. The person's total may, through other seats, network and experience.

A person with no seats, network or experience gets a floor of 1.

## 5. Levels

`score` is `log10(power)`. Use the same fixed bands in every workspace:

| Power (staff-equivalents) | Level |
|---|---|
| under 10 | 1 |
| 10 to under 100 | 2 |
| 100 to under 1,000 | 3 |
| 1,000 to under 10,000 | 4 |
| 10,000 and up | 5 |

The page shows **points from 0 to 1000** instead of the level, so parties in the
same band still differ: `points = round(clamp(log10(power) × 125, 0, 1000))`.
Every tenfold is 125 points: 1 staff-equivalent is 0, 100 is 250, 10,000 is
500, 1 million is 750, and 100 million or more is 1000. The level stays as a
coarse band.

Each result also carries `reasons`, one short sentence per part that counted
("About 12,000 employees", "Owns 60 percent of Company A", "Former director of
Engineering until 2021", "Connected to 6 organizations", "About 15 years in
senior roles"), and `estimated` when a default or a stale link was used.

## 6. Power over our work

Take general power and scale it by **closeness** `c` to us. "Us" means our
organization, its parents and owners, and its own boxes.

- in us, or our owner or parent: 1
- regulates us: 1
- funds us: 0.8
- our client (`contracts_with` us): 0.7
- otherwise: `0.5 ^ d`, where `d` is the fewest links (any kind, either
  direction, times `t`) to us
- not connected at all: 0.01

`PowerOverUs = Power × c`, using the same level bands. With no organization
set, it equals general power.

## Tests the model must pass

- A owns B, so A is above B.
- C's company is far bigger than A's, so C is above A.
- A CEO beats a staff member of the same company.
- A team lead in a huge company can beat the CEO of a tiny company.
- Current director beats former director, with identical links and years.
- A former seat fades as years pass, but never below the floor.
- A former CEO with board seats elsewhere beats a new staff member.
- Ownership cycles finish.
- For power over us, a small regulator of us beats a huge unrelated company.
