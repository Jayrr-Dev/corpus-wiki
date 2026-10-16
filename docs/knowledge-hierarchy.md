# Knowledge hierarchy

The hierarchy has three independent concepts: an entity supplies context, a topic
organizes knowledge within that context, and an article presents that knowledge.
Claims and sources remain independent records with their existing provenance.

## Revision context

Each new claim revision stores `knowledge_context`: the entities it is about
(`subject`, `object`, or `mentioned`) and separate applicability. Applicability is
`unspecified`, `general`, or `scoped`; scoped knowledge names entities and/or
textual conditions. Missing context never means universal applicability.
`unit_entities` projects the current revision's entity roles for existing views.
Current legacy revisions retain their recorded links with unspecified applicability;
older revisions without a known snapshot remain unknown.

Context corrections use `revise_claim` through Change Control. Omitting context
preserves it; supplying context replaces it. Undo restores the previous snapshot.
Both the old and new matching article sections are marked for rebuilding.

An entity article can include knowledge about that entity or explicitly applicable
to it. Passing mentions do not establish ownership. A person's role at a company
can therefore appear in both contexts, with its company qualification preserved.
General knowledge is not automatically owned by the company whose document contains it.

Duplicate detection requires compatible, explicitly known applicability and matching
subject/object identities even for identical wording. Unspecified scopes remain
separate. A merge preserves source citations in a new survivor revision and can be undone.

The Units view exposes applicability filters; unit details support audited context
corrections. Ask accepts an optional entity context and labels applicability in its
evidence. Scoped answers use verified claims and eligible article lines, rather than
raw passages that may mix several companies' policies.

```text
Knowledge
├── Utilitek Solutions Inc.          entity context + overview article
│   └── Health & Safety             topic + hub article
│       ├── Hazard Assessment       topic article with definitions and requirements
│       ├── Incident Reporting
│       ├── PPE
│       └── Training
├── Another company                 independent context, independent policies
│   └── Health & Safety
└── General topic                   no entity context
    └── General concept article
```

Contexts can be companies, organizations, people, projects, teams, or products.
General articles have no context entity. A shared concept is not automatically
owned by an organization simply because its name occurs in a source. Definitions
of a company's own procedures explicitly retain that company context.

## Stored relationships

- `domains.context_entity_id`: entity context for the root and its topic branches.
- `domains.parent_id`: actual topic containment; paths reflect the hierarchy.
- `pages.context_entity_id`: the context whose claims the article presents.
- `pages.domain_id`: the topic the article explains.
- `pages.parent_page_id`: the containing article, used for navigation and breadcrumbs.
- `sections.query.entity` and `domainPaths`: intersect context with topic when
  selecting claims. Article navigation is never used as a substitute for filtering.

An entity overview is the root article. Topic articles sit beneath it, matching
the topic hierarchy. More specific thematic articles can sit beneath topic hubs.
General articles stay at the root. Existing URLs remain stable during organization.
The page tree tolerates missing parents and detects cycles rather than hiding data.

## Automatic organization

Reconciliation assigns company-specific claims to `Entity name/Topic/Subtopic`
and uses context-free paths only for genuinely general knowledge. The entity's
natural key distinguishes identity from its display name. Topic names may repeat
under different contexts; the full path distinguishes them. There is no fixed
three-level limit; add a level only when evidence supports a useful topic.

`organize_entity_context` runs in a transaction with an advisory lock. It moves
only topic branches whose current knowledge has exactly one context owner. Shared,
ambiguous, or mixed branches remain in place rather than guessing ownership.
Conflicting destination paths are preserved for explicit reconciliation. It updates
section paths atomically and restricts company article queries to that entity.
The function infers page ownership from actual cited claims, chooses the closest
topic hub as the parent, and records before/after metadata in `hierarchy_changes`.
It does not rewrite claims, source passages, or citation IDs. Only the service role
can run the organizer. Uploads rerun it after page generation and rebuilding.

## Labels

Knowledge labels are short navigation text, separate from authoritative content.
Prefer a known concept subject, then a recognizable topic, then a bounded fallback
of at most five words and 48 characters. Never shorten the stored claim to make a
label. Full claims and source passages remain available in the knowledge detail.
