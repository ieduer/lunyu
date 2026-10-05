# Analects consolidation candidate

The reconciliation tools remain read-only and are not a grading authority.
A local reader navigation candidate now uses the existing runtime; the full
four-site merger is not deployed or accepted. It uses the existing KZ, LY and Weibian sources; the generated
registry is a display index, not an independently editable content catalogue.

From this repository, with Node 24.18.0:

```sh
node scripts/consolidation/build-candidate.mjs /Users/ylsuen/CF --check
node --test scripts/consolidation/test-core.mjs
npm run check
```

The generator deliberately pins the accepted source bytes and fails on drift.
Omit `--check` only when regenerating this reviewed candidate. Generated files
contain public corpus metadata and public task references, never student data.

- All 541 historical resource IDs and the completion threshold of 163 remain
  unchanged; 29 aliases group into 512 passages only for display.
- LY's original content and complete game remain authoritative. No game state,
  stage, SRS state, virtue or streak is rewritten by these scripts.
- The progress projector requires a verified single-owner input and retains
  source references. Its assessment flag is an adapter precondition, not an
  authentication or evidence verifier. It is not safe to connect arbitrary
  browser input directly. Runtime adapters and real owner acceptance remain open.
- Daily comparison covers complete plan objects, details and metadata. Matching
  files do not prove My, homework, ICS or the bot adopted them. Production task
  synchronization, historical scoring preservation and live readback remain open.
- Preservation checks require per-record review and recovery receipts. Passing
  them never authorizes production or grants points. Unknown offline coverage
  must remain unknown. Exam duplicate suggestions require original-paper review.

The user has authorized direct review and grading of recoverable student work.
This must be integrated into the existing central evaluation authority with
truthful review provenance, immutable originals, deduplication and actual
write/readback acceptance. A failed service operation is not a wrong answer.

Current evidence and serial continuation authority:
`/Users/ylsuen/CF/reports/operations/analects-consolidation-20261004/HANDOFF.md`.
No production deployment, data migration, student grading write or bot message
has been performed by this candidate. Recover this branch in a registered
isolated worktree; preserve unrelated dirty work in the canonical checkout.
