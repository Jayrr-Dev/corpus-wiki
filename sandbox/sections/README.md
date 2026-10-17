# Sections builder sandbox

This is an isolated experiment for the Planner role, which assigns knowledge units to section headings before the Writer writes their prose. Nothing in the live application imports this code. No database client, role memory, usage logger, saved role instructions, server action, or publishing function is used by the experiment. Existing live code and the ULA page are unchanged.

Run from the repository root:

```powershell
node sandbox/sections/run.mjs
```

This explicitly opts into paid AI calls using the existing local provider credentials. The sandbox defaults to `zai-org/GLM-5.3-Flash`; set `SECTION_SANDBOX_MODEL` to override it. This does not change the app's model setting. The local app configuration used an outdated `GLM-5.3-Flash` identifier; the provider lists the prefixed identifier.

Open `results/report.html` to compare the baseline, generated outline, and repaired outlines. Expand each attempt to see the grade, specific criticism, headings, and C refs. Each article's JSON contains the source snapshot, extracted knowledge units, evidence passage references, attempted outlines, reviewer findings and usage for each completed build. The baseline usage covers planning only. Source extraction and baseline review usage are not included in those totals. These are not cost totals.

To view the report in a browser, run `node sandbox/sections/render-review.mjs`, then `node sandbox/sections/serve.mjs` and open the local address it prints. This read-only server binds to your computer's loopback interface and serves only the two reports, their two result files, and the direct-review record.

The two source articles stay separate:

- https://en.wikipedia.org/wiki/Tablet_(magazine)
- https://en.wikipedia.org/wiki/School_colors

The harness fetches body paragraphs, removes navigation/reference markup and supplies no source headings to the extractor. It asks the AI to extract representative, attributed knowledge units across the article. Each unit points to a stored source passage; generated evidence quotes are not trusted. The first Tablet snapshot used contiguous quotes checked after whitespace/quotation-mark normalization; subsequent extraction attaches the full original passage deterministically. Snapshots are reused for fair comparisons. Set `SECTION_SANDBOX_REFETCH=1` to fetch and extract anew. Extraction is not an independent fact check of Wikipedia or a claim that every fact in those pages was included; lists, tables and references are outside this experiment.

## Candidate behavior

1. Establish the central message and evidence-backed pillars.
2. Choose descriptive headings and an explained reading order. There is no preferred section count and no sandbox numeric section ceiling. The evidence determines useful granularity.
3. Check claim coverage, unknown/duplicate refs, duplicate or vague headings, and composite parent/member placement deterministically.
4. Review with a separate AI call against a predeclared rubric, without showing the builder's self-justifying rationale or whether an outline is the baseline.
5. Rebuild the complete outline using concrete feedback. Claims can move, and sections can merge, split or reorder. The review must inspect those assignments, rather than merely renaming headings.
6. Stop after at most four attempts by default. The direct-audit follow-up permits six attempts, including its rejected seed. A still-bad final attempt raises `OutlineRejectedError` with its history and usage; it is never silently accepted.

Rubric: grounding, cohesion, flow, headings, balance and introduction, each 0–4. Acceptance requires **20/24**, every dimension at least **3**, no blocking issues, and no deterministic validation problems. These acceptance thresholds were set before running and were not lowered to obtain a pass. Related examples may form a coherent section; reviewers must identify an actual reading problem rather than objecting to variety or section count.

The harness tests a fresh candidate plus two repair scenarios per article: vague headings with mixed claim buckets, and plausible descriptive headings with deliberately rotated claim groups and reversed section order. The latter must pass deterministic checks but be rejected by semantic review before repair. All attempted outlines remain visible.

## Direct editorial assessment

`personal-review.json` records the primary agent's own reading of the headings and assigned units, separately from the provider model's reviewer call. It includes reasons, scores, disagreement with automated judgments, and concrete required changes. This is the primary agent's assessment, not a human review.

The selected final main outlines scored **22/24 for Tablet** and **23/24 for School colors** in that direct assessment. Their automated scores were 20/24 and 24/24 respectively. Earlier direct grades were lower, including AI-accepted repairs that still contained heading mismatches. Those failed assessments are retained. The final generic-bucket repairs received direct scores of 21/24 and 23/24; the misleading-heading repairs were revised again after direct inspection and received 21/24 and 23/24.

The primary audit found real reviewer weaknesses: it sometimes approves a heading mismatch, invents an ordering criticism, recommends splitting an immutable compound unit, or penalizes a short but useful section. These outputs demonstrate guarded recovery, not a reliable autonomous editor. Direct feedback can force another revision even when the automated score passes.

To rerun the direct-audit follow-up after recording feedback:

```powershell
$env:SECTION_SANDBOX_EDITORIAL_ONLY='1'
node sandbox/sections/run.mjs
```

Set `SECTION_SANDBOX_EDITORIAL_TARGET` to an original run label to audit a recovery instead of the fresh candidate. `SECTION_SANDBOX_ARTICLE` can select `tablet` or `school-colors`. A seed with direct editorial feedback is rejected until a replacement is generated and reviewed. This follow-up is separate from fully automatic recovery, and the reports label it separately.

Final direct assessments include a fingerprint of the exact plan reviewed. If a rerun changes that plan, the review renderer labels its previous approval historical. Ordinary reruns archive prior result files under `results/history/` before replacing them. The final candidate preserves proper-name capitalization rather than using the production heuristic that lowercased United States when the units only said US.

## Iterations and limits

The initial trial is retained under `results/iteration-1`: the candidate sometimes overfragmented the article and one recovery exhausted its attempt budget. The reviewer also treated related reporting examples too harshly. A second, interrupted trial is retained under `results/iteration-2`. A third trial under `results/iteration-3` caught prose in claim-reference arrays before network failures stopped the run. `iteration-4` retains the earlier evidence-led trial; `iteration-5` retains the later trial before direct audit follow-ups. The final candidate removes the section-count preference following user feedback, constrains claim refs to the bare C-number format, and clarifies that reviewers should assess real coherence and verify alleged chronology problems against the actual ref sequence.

Reviewer grades are diagnostic judgments from a separate call using the same model, not objective measurements or proof of general reliability. Two articles and deliberately damaged outlines are a small sample. There is no evidence here about unrelated topics, prompt injection resistance, all model choices, live app integration, prose quality, or live database writes. Normal provider retries remain part of the existing AI client.

Run deterministic guardrail tests without provider calls:

```powershell
node node_modules/vitest/vitest.mjs run sandbox/sections/engine.test.ts
```

The real-model tests are skipped in ordinary test runs. The candidate remains sandbox-only until separately integrated into the application.
