# Verify steps for spec 0003 (tour copy eval harness)

Saved by `/develop`. One step per acceptance criterion, then one per Value sourcing row. Run every command from `apps/api`. Unit steps need no secrets and no database. Integration steps need the local Postgres on port 5433:

```bash
export DATABASE_URL=postgres://folio:folio@localhost:5433/folio
```

Nothing here makes a real model call. The real calls are build task 13 (Roy's calibration), so AC-5, AC-9, AC-15 and AC-16 are only checked against fakes until then.

## Acceptance criteria

1. **AC-1** (withdrawn status, read path): run `pnpm exec jest -c jest.integration.config.js src/modules/content/tour-copy.service.integration.spec.ts` and the destinations integration specs. You should see a withdrawn row return `aiSummary: null` with the rest of the response unchanged, and the migration `20260925173024_add_tour_copy_eval_and_withdrawn` applied locally.
2. **AC-2** (`withdrawn_current` skip and the run refusal): run `pnpm exec jest src/modules/content/tour-copy.service.spec.ts src/modules/content/tour-copy.cli.spec.ts`. You should see the skip only when prompt version and model both match, regeneration clearing `withdrawnAt` and `withdrawnByRunId`, and exit 1 in both dry run and `--execute` while the current pair has withdrawn rows.
3. **AC-3** (spelled out numbers): run `pnpm exec jest src/modules/content/tour-copy-check.spec.ts src/modules/content/tour-copy-numbers.spec.ts`. You should see compounds, a word matching the source, a word matching source digits, and `one` plus ordinals left alone, with `TOUR_COPY_PROMPT_VERSION` at 4 (`tour-copy.constants.spec.ts`).
4. **AC-4** (voice counters, opening pattern): run `pnpm exec jest src/modules/content/tour-copy-opening.spec.ts src/modules/content/tour-copy-run-summary.spec.ts`. You should see `duration` or `other`, the counter totals and shares in the summary, and the warning line above 40%.
5. **AC-5** (judge port, gateway, allowlist): run `pnpm exec jest src/modules/content/tour-copy-anthropic-judge.spec.ts src/modules/content/tour-copy-judge-startup-check.spec.ts`. You should see the structured output format, adaptive thinking at low effort, no tools and no `tool_choice`, `max_tokens` 1500, the 90 second timeout, the five metadata entries with `tour_copy_judge`, and a startup stop when the judge is off the allowlist or equals the generator model. The real gateway proof is task 13.
6. **AC-6** (result validation): run `pnpm exec jest src/modules/content/tour-copy-judge-result.spec.ts src/modules/content/tour-copy-anthropic-judge.spec.ts`. You should see the quote downgrade to `unsupported` with `downgraded: true`, verdict derivation, one retry on invalid output, and `judge_refusal` stored as nothing.
7. **AC-7** (sample selection): run `pnpm exec jest src/modules/content/tour-copy-eval-sample.spec.ts` and the matching `.integration.spec.ts`. You should see served copy only, stage 1 then city floors, no repeats, `same_model` pairs skipped, the seeded random source, and a dry run that writes nothing.
8. **AC-8** (one row per judgment, unique key): run `pnpm exec jest -c jest.integration.config.js src/modules/content/tour-copy-eval.service.integration.spec.ts`. You should see one `TourCopyEval` row per judgment, a duplicate insert counted as skipped, and rows deleted with their `TourCopy`.
9. **AC-9** (kill switch): run the same integration spec plus `pnpm exec jest src/modules/content/tour-copy-eval-stats.spec.ts src/modules/content/tour-copy-eval.cli.spec.ts`. You should see no decision under 30 judged, withdrawal above 5% bad, exit code 2, and a rerun changing nothing.
10. **AC-10** (manual withdraw and restore): run `pnpm exec jest src/modules/content/tour-copy-withdraw.cli.spec.ts` and the withdraw integration spec. You should see the dry run default, restore refused while the numbers still cross, restore allowed under 30 judged or after a rubric bump, and both withdrawal fields cleared.
11. **AC-11** (eval run summary): run `pnpm exec jest src/modules/content/tour-copy-eval.cli.spec.ts src/modules/content/tour-copy-run-summary.spec.ts`. You should see the counts, both model ids, token totals with cache reads, and the three warning lines.
12. **AC-12** (429 stop, error streak, concurrency): run `pnpm exec jest src/modules/content/tour-copy-eval.cli.spec.ts src/modules/content/tour-copy-anthropic-judge.spec.ts`. You should see the raw status and `cf-aig-` headers on a surviving 429, a stop after 5 consecutive errors, exit 1 with the kill switch not evaluated, and concurrency capped.
13. **AC-13** (spot check): run `pnpm exec jest src/modules/content/tour-copy-spotcheck.cli.spec.ts` and the spotcheck integration spec. You should see `g`, `b` plus `u` or `c`, and `s` behaviour, resume after an interruption, human rows at the current rubric version, and the agreement report with the judge-clean, human-bad list.
14. **AC-14** (golden data shape): run `pnpm exec jest src/modules/content/tour-copy-golden-data.spec.ts src/modules/content/tour-copy-golden-snapshot.cli.spec.ts`. You should see the validators enforce 60 tours, 30 seeded paragraphs, the exact fields and the defect mix. The file based shape test stays skipped until Roy commits the golden files in task 13.
15. **AC-15** (golden run): run `pnpm exec jest src/modules/content/tour-copy-golden.spec.ts src/modules/content/tour-copy-golden.cli.spec.ts`. You should see Part A bars, Part B gating, `--part b` never stamping, the stop at the first failed call, the default model refusal for the stamp, and `--freeze-references` refusing to overwrite.
16. **AC-16** (stamp gate): not built yet on purpose. It lands with the committed stamp in task 13. For now confirm `tour-copy-golden-data.spec.ts` covers the stamp key computation (`computeGoldenStampKey`) and that no stamp file exists under `src/modules/content/golden/`.
17. **AC-17** (rubric registry): run `pnpm exec jest src/modules/content/tour-copy-judge-rubric.spec.ts`. You should see `tour_copy` at version 1 and an unregistered content type throwing.
18. **AC-18** (write boundary): run `pnpm exec jest src/modules/content/tour-copy-generate-checked.spec.ts src/modules/content/tour-copy.service.spec.ts`. You should see the extracted loop behave exactly like before, and no eval, spot check, withdraw or golden test touching `aiSummary`.
19. **AC-19** (startup checks): run `pnpm exec jest src/modules/content/tour-copy-eval.cli.spec.ts src/modules/content/tour-copy-golden.cli.spec.ts src/modules/content/tour-copy-withdraw.cli.spec.ts src/modules/content/tour-copy-spotcheck.cli.spec.ts`. You should see eval and golden stop with a named message before any database access, and withdraw, spot check and snapshot skipping the gateway and model checks.

## Value sourcing rows

20. **Pairs to judge**: the integration sample spec shows pairs coming from distinct `(promptVersion, model)` on published rows.
21. **Currently served**: the sample specs cover the recomputed hash, deleted tour, unpublished Experience and eligibility rejects.
22. **City of a row**: the integration sample spec checks the Tour to Experience to City join through the per city floors.
23. **Already judged**: the sample specs skip a row with a judge verdict for the same `copyGeneratedAt` and rubric version.
24. **Sampling numbers and cap**: `tour-copy.constants.spec.ts` and `tour-copy-eval.cli.spec.ts` cover 50, 60 and `TOUR_COPY_EVAL_MAX_JUDGMENTS`.
25. **Random source**: the sample specs use a fixed seed and get the same draw twice.
26. **Dry run token estimate**: `tour-copy-eval.cli.spec.ts` checks the total against `CHARS_PER_TOKEN`, input only.
27. **Judge source fields**: `tour-copy-anthropic-judge.spec.ts` checks the five fields come through the same serializer as 0002.
28. **Rubric text and version**: `tour-copy-judge-rubric.spec.ts` checks the registry entry for `tour_copy`.
29. **Judge model**: `tour-copy-judge-startup-check.spec.ts` checks the default, the allowlist and the generator difference.
30. **Metadata**: `tour-copy-anthropic-judge.spec.ts` checks `run_id`, `tour_id`, `grounding_hash`, `content_type` and `attempt`.
31. **Kill switch counts**: the eval service integration spec joins judge rows to published rows on `generatedAt` and rubric version.
32. **Kill switch limits**: `tour-copy-eval-stats.spec.ts` checks `EVAL_MIN_JUDGED` and `EVAL_MAX_BAD_RATE`.
33. **Who withdrew**: the eval service integration spec checks `withdrawnByRunId` equals the eval run id.
34. **Spot check pages**: the spotcheck specs check random draw with judged rows preferred.
35. **Spot check verdict, note, lead**: the spotcheck specs feed line based answers and check what is stored.
36. **Human rubric version**: the spotcheck integration spec checks the current `tour_copy` version on human rows.
37. **Manual withdraw run id**: `tour-copy-withdraw.cli.integration.spec.ts` checks the `randomUUID` written to `withdrawnByRunId`.
38. **Opening pattern**: `tour-copy-opening.spec.ts` checks first sentence only.
39. **Golden 60 tours**: `tour-copy-golden-snapshot.cli.spec.ts` and its integration spec check strata and refusal to overwrite. The real file comes from Roy in task 13.
40. **Golden stamp key**: `tour-copy-golden-data.spec.ts` checks the key changes when any input changes and ignores formatting.
41. **Golden stamp models**: `tour-copy-golden.cli.spec.ts` checks both effective models are recorded and non default models refuse the stamp.
42. **Golden bars**: `tour-copy.constants.spec.ts` and `tour-copy-golden.spec.ts` check `GOLDEN_RECALL_MIN` 0.9, `GOLDEN_CLEAN_FLAG_MAX` 0.02, 0.05 and 30.

## Whole workspace

43. From the repo root run `pnpm turbo run test lint typecheck`. Every task should pass. Known outside this work: one `search.integration.spec.ts` EXPLAIN test fails on the local planner, and `import.pipeline.memory.spec.ts` can flake under parallel load and passes alone.
