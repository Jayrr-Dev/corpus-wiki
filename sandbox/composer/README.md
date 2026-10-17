# Composer: text-only article experiment

The Composer scans article paragraphs, chooses a small number of useful illustrations, creates original SVGs, and places each after a stable paragraph id. The input has `existingFigures: []`; no Wikipedia images or prebuilt illustrations are given to the model. Original paragraph text is preserved in the before and after views.

Run from the repository root:

```powershell
node sandbox/composer/run.mjs
node sandbox/composer/serve.mjs
```

The first command opts into real paid AI calls using the application's configured provider credentials. It fetches the two public benchmark pages once, stores their extracted paragraphs and full-response SHA-256 locally, and writes `results/demo.html` and per-article JSON histories. It never imports application server dependencies or connects to a database. The second command prints the local demo URL. Open “Before: text only” for the unillustrated article and “Grades and revision history” to inspect failures as well as improvements.

Environment controls: `COMPOSER_MODEL` selects a configured provider/model; `COMPOSER_ARTICLE` selects `apple` or `utility-pole`; `COMPOSER_FEEDBACK` adds editorial feedback; `COMPOSER_REDESIGN=1` starts the next attempt without the previous drawing. Cached passing results are reused unless explicit feedback is supplied. Each invocation permits at most three new attempts per article and fails if the last attempt is rejected. Failed attempts are retained. A rerun therefore does not erase a failure. The schema permits zero figures on ordinary articles; the benchmark additionally requires a delivered figure to demonstrate the feature.

The rubric is fixed: usefulness, grounding, restraint, visual design, and accessibility, each 0–4. Passing requires at least 17/20, no score below 3, no reported blocking problems, and SVG checks passing. A separate call reviews SVG code and evidence; it is **not** a rendered vision review or an independent factual authority. It uses the same selected model and can make mistakes, including incorrect proposed fixes. Browser inspection and a direct editorial audit are required before declaring the result visually successful. Scores from two selected subjects do not establish general reliability.

Initial fast-model results exposed inaccurate leader endpoints, cramped text, mixed botanical viewing planes and unnecessary electrical topology. The role policy was revised to require at most four labels, wider margins, larger type, no crossing leaders, a consistent viewing plane, verified transformed endpoints, and omission of electrical connections outside the learning goal. Fresh redesigns and a stronger model are tested after those failures. The JSON records preserve which model and policy hash produced subsequent attempts; earlier attempts predate this added metadata.

Original experiment scope: the role was registered in the source roster and tested in disposable PostgreSQL before live insertion was connected. The implemented demo capability is original static SVG. The role policy describes when licensed online assets, image-generation tools and HTML/CSS would be appropriate, but those adapters are not connected or advertised as available to this sandbox. No raster generation or online-image acquisition has been tested.

Subsequent live work: Composer now runs from the article's “Illustrate article” action. Figures are stored as reversible, authenticated derived assets, separate from article prose and evidence. “Remove Composer illustrations” and “Undo removal” are available; changed article snapshots invalidate old illustrations. The role and live-storage migrations were applied after isolated tests passed. Live audit evidence is in `artifacts/composer-live/personal-review.json` and adjacent run directories. The user's supplied spatial reference images tightened the policy and reviewer: physical-clearance articles now require object-based spatial drawings, not bar charts. The old numeric chart was retired and replaced with a two-scene engineering section. The historical benchmark scores below predate that clarification.

## Direct visual audit and final results

`personal-review.json` contains the primary agent's own scores, reasons, limitations and earlier rejection. The primary agent inspected both final figures in the browser at the normal viewport and 360px width. Screenshots are in `results/apple-review.png` and `results/utility-pole-review.png`.

- Apple: automated review 19/20 on attempt 11; primary agent 17/20. One grafting diagram. The primary agent rejected attempt 10 at 16/20 despite its automated 19/20, requested organic foliage, branching and material shading, then inspected the revision. It passes as a clear 2D schematic, not as semi-realistic art.
- Utility pole: automated review 18/20 on attempt 8; primary agent initially 18/20 at the normal viewport, lowered to 17/20 after the narrow-screen inspection. One vertical-zones schematic. Unnecessary electrical topology was removed. Small embedded labels remain the main limitation.

Final outputs used `anthropic/claude-opus-5-5`; earlier attempts used `zai-org/GLM-5.3-Flash`. These are iterative development runs, including explicit editorial feedback, not a blind or held-out benchmark. The reviewer prompt was also clarified during development to separate blocking defects from minor suggestions; neither the numerical threshold nor the five scored dimensions changed. `results/*.json` preserves all 19 attempts, including rejected drawings. A cached rerun verifies the final acceptance records and rebuilds the demo without making new AI calls.

Validation: 14 Composer-specific unit/database checks pass, lint passes on the changed Composer files, and both real-model benchmark runs reached acceptance. A complete project typecheck currently fails in the unrelated `scripts/live-page-sections.ts`; the broader existing skill suite also has a planner-fixture failure after concurrent outline-builder changes. No files belonging to those other changes were edited.

Sources: [Apple](https://en.wikipedia.org/wiki/Apple) and [Utility pole](https://en.wikipedia.org/wiki/Utility_pole), Wikipedia contributors. Extracted article prose is reused under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/); the original file histories provide author attribution. Navigation, tables, lists, references and existing figures are excluded. The benchmark is based on article paragraphs, not independent verification of their underlying sources.
