import { deepEqual, equal, ok } from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { checkPass, preflight } from "./check.ts";
import { scoreLinked } from "./score.ts";
import { FIXTURE_ROOT, type IssuePreflight, type JsonObject, SIGIL_REPO, sigil, sigilcPath } from "./sigil.ts";
import type { PlantedOutcome } from "./types.ts";

const { SLOTTED_FIXTURE } = await sigil();
const { renderReport } = await import(`file://${SIGIL_REPO}/scripts/slotted-benchmark/report.ts`);
const { pendingRecord } = await import(`file://${SIGIL_REPO}/scripts/slotted-benchmark/batch.ts`);

/** The planted problems with Facet ids, as sigil's own report tests set them up. */
const ISSUES: IssuePreflight[] = SLOTTED_FIXTURE.issues.map((issue, index) => ({
  ...(issue as unknown as IssuePreflight),
  status: "scorable",
  reason: null,
  facets: [["F-range-interface", "F-range-constraint"], ["F-booking-mark", "F-rooms-mark"], ["F-display"], ["F-digest"]][index]!,
}));

/** What sigil's own report says for each planted problem of one valid pass. */
function sigilOutcomes(report: JsonObject, context: JsonObject, issues: IssuePreflight[]): Record<string, PlantedOutcome> {
  const manifest = {
    version: 2,
    createdAt: "t",
    fixture: SLOTTED_FIXTURE,
    preflight: { canSchedule: true, sourceDrift: [], issues },
    schedule: [{ id: "000001", agent: "claude", model: "m", pass: 1 }],
    input: { workspaceDigest: "d" },
    tools: { sigilcSha256: "x" },
    timeoutMs: 1,
    reasoning: null,
  };
  const record = {
    ...pendingRecord(manifest.schedule[0]),
    status: "valid",
    state: report.state,
    handbackState: report.state,
    observedModels: [],
    childModels: [],
    childEfforts: [],
    outcomePath: "o.json",
  };
  const text: string = renderReport(manifest, [{ record, outcome: { linked: { validation: { valid: true }, report, context } } }]);
  const outcomes: Record<string, PlantedOutcome> = {};
  for (const issue of issues) {
    const match = new RegExp(`${issue.id}: (\\d+)/(\\d+)`).exec(text);
    if (issue.status === "drift" || !match) outcomes[issue.id] = "n/a";
    else outcomes[issue.id] = match[2] === "0" ? "n/a" : match[1] === "1" ? "found" : "missed";
  }
  return outcomes;
}

const contradiction = {
  class: "contradiction",
  law: "contradictory-claims",
  subject: "urn:sigil:component:booking.sigil:Booking",
  object: "urn:sigil:component:booking.sigil:Booking:tag:range%20change",
  claims: ["witness-1"],
};
const ownershipIssue = SLOTTED_FIXTURE.issues[1] as unknown as IssuePreflight;
const ownership = {
  class: ownershipIssue.findingClass,
  law: ownershipIssue.laws[0],
  subject: ownershipIssue.findingEvidence.subject,
  object: ownershipIssue.findingEvidence.object,
  claims: ["mark-witness"],
};
const unmetIssue = SLOTTED_FIXTURE.issues[2] as unknown as IssuePreflight;
const flowIssue = SLOTTED_FIXTURE.issues[3] as unknown as IssuePreflight;
const unmet = {
  class: unmetIssue.findingClass,
  law: unmetIssue.laws[0],
  subject: unmetIssue.findingEvidence.subject,
  object: unmetIssue.findingEvidence.object,
  claims: ["display-claim"],
};
const flow = { class: flowIssue.findingClass, law: flowIssue.laws[0], subject: "digest-claim", object: flowIssue.findingEvidence.object, claims: ["digest-claim"] };
const context = {
  units: [
    { facet: "F-range-interface", asserted: [{ claim: "witness-1" }] },
    { facet: "F-booking-mark", asserted: [{ claim: "mark-witness" }] },
    { facet: "F-display", asserted: [{ claim: "display-claim" }] },
    { facet: "F-digest", asserted: [{ claim: "digest-claim" }] },
    { facet: "F-unrelated", asserted: [{ claim: "unrelated-claim" }] },
  ],
};
const report = (findings: unknown[], unread: unknown[] = []) => ({
  source: "workspace",
  state: unread.length ? "incomplete" : "disjoint",
  findings,
  unread,
  unresolvedImports: [],
});

const CASES: Record<string, { report: JsonObject; context: JsonObject }> = {
  "all four found": { report: report([contradiction, ownership, unmet, flow]), context },
  "ownership in the reverse direction": {
    report: report([{ ...ownership, subject: ownership.object, object: ownership.subject }]),
    context,
  },
  "witness on an unrelated Facet": { report: report([{ ...unmet, claims: ["unrelated-claim"] }]), context },
  "right class and law, wrong subject": { report: report([{ ...contradiction, subject: "urn:example:wrong" }]), context },
  "flow subject not a cited claim": { report: report([{ ...flow, subject: "other-claim" }]), context },
  "anchor Facet unread": {
    report: report([contradiction, ownership], [{ source: "rooms.sigil", section: "state", facets: ["F-rooms-mark"] }]),
    context,
  },
  "whole source unread": { report: report([unmet], [{ source: "calendar.sigil", facets: [] }]), context },
  "nothing found": { report: report([]), context },
};

// The outcome each case must give, so agreement with sigil is never vacuous.
const EXPECTED: Record<string, PlantedOutcome[]> = {
  "all four found": ["found", "found", "found", "found"],
  "ownership in the reverse direction": ["missed", "found", "missed", "missed"],
  "witness on an unrelated Facet": ["missed", "missed", "missed", "missed"],
  "right class and law, wrong subject": ["missed", "missed", "missed", "missed"],
  "flow subject not a cited claim": ["missed", "missed", "missed", "missed"],
  "anchor Facet unread": ["found", "n/a", "missed", "missed"],
  "whole source unread": ["missed", "missed", "n/a", "n/a"],
  "nothing found": ["missed", "missed", "missed", "missed"],
};

for (const [name, { report, context }] of Object.entries(CASES)) {
  Deno.test(`scores like sigil's own report: ${name}`, () => {
    const ours = scoreLinked({ report, context }, ISSUES).planted;
    deepEqual(Object.values(ours), EXPECTED[name]);
    deepEqual(ours, sigilOutcomes(report, context, ISSUES));
  });
}

Deno.test("an unread anchor Facet scores N/A, not missed", () => {
  const { report, context } = CASES["anchor Facet unread"];
  equal(scoreLinked({ report, context }, ISSUES).planted["booking-rooms-archived-mark-ownership"], "n/a");
});

Deno.test("the right class and law with the wrong subject counts as extra, not a match", () => {
  const { report, context } = CASES["right class and law, wrong subject"];
  const score = scoreLinked({ report, context }, ISSUES);
  equal(score.planted["booking-pending-range-contradiction"], "missed");
  deepEqual(score.extra, [0]);
});

/** What sigil's report lists as additional findings for the pass. */
function sigilExtraCount(report: JsonObject, context: JsonObject, issues: IssuePreflight[]): number {
  const manifest = {
    version: 2, createdAt: "t", fixture: SLOTTED_FIXTURE,
    preflight: { canSchedule: true, sourceDrift: [], issues },
    schedule: [{ id: "000001", agent: "claude", model: "m", pass: 1 }],
    input: { workspaceDigest: "d" }, tools: { sigilcSha256: "x" }, timeoutMs: 1, reasoning: null,
  };
  const record = { ...pendingRecord(manifest.schedule[0]), status: "valid", state: report.state, handbackState: report.state, observedModels: [], childModels: [], childEfforts: [], outcomePath: "o.json" };
  const text: string = renderReport(manifest, [{ record, outcome: { linked: { validation: { valid: true }, report, context } } }]);
  return text.split("\n").filter((l) => l.startsWith("- Attempt 000001, finding")).length;
}

// sigil's retained reference runs: real stored readings, checked against the planted fixture.
const REFERENCE_RUNS = (() => {
  try {
    return [...Deno.readDirSync(join(SIGIL_REPO, ".benchmarks"))]
      .filter((e) => e.name.startsWith("reference-slotted-") && existsSync(join(SIGIL_REPO, ".benchmarks", e.name, "store", "claims")))
      .map((e) => join(SIGIL_REPO, ".benchmarks", e.name, "store"));
  } catch {
    return [];
  }
})();

Deno.test({
  name: "scores the stored workspaces of sigil's reference runs as sigil's own report does",
  ignore: REFERENCE_RUNS.length === 0,
  fn: async () => {
    const sigilc = sigilcPath();
    const { copyTree } = await sigil();
    for (const reference of REFERENCE_RUNS) {
      // Copies only: the sigil repository is never written.
      const scratch = Deno.makeTempDirSync({ prefix: "bench-reference-" });
      const root = join(scratch, "root");
      const store = join(scratch, "store");
      await copyTree(FIXTURE_ROOT, root, new Set([".sigil/claims"]));
      await copyTree(reference, store, new Set());
      const pre = await preflight(sigilc, root, join(scratch, "pre"));
      const check = await checkPass(sigilc, root, store, pre.expected);
      equal(check.validation?.valid, true, `${reference}: ${check.validation?.errors.join("; ")}`);
      const ours = scoreLinked({ report: check.report!, context: check.context! }, pre.issues);
      deepEqual(ours.planted, sigilOutcomes(check.report!, check.context!, pre.issues), reference);
      equal(ours.extra.length, sigilExtraCount(check.report!, check.context!, pre.issues), reference);
      ok(ours.extra.length > 0, `${reference} has real findings`);
    }
  },
});

Deno.test("scores a real sigilc check of the planted fixture like sigil's own report", async () => {
  const sigilc = sigilcPath();
  const scratch = Deno.makeTempDirSync({ prefix: "bench-score-" });
  const { copyTree } = await sigil();
  const root = join(scratch, "root");
  await copyTree(FIXTURE_ROOT, root, new Set([".sigil/claims"]));
  const store = join(scratch, "store");
  mkdirSync(store);
  const pre = await preflight(sigilc, root, join(scratch, "pre"));
  equal(pre.issues.every((i) => i.status === "scorable"), true);
  const check = await checkPass(sigilc, root, store, pre.expected);
  equal(check.validation?.valid, true, check.validation?.errors.join("; "));
  equal(check.result?.state, "incomplete");
  const ours = scoreLinked({ report: check.report!, context: check.context! }, pre.issues);
  deepEqual(ours.planted, sigilOutcomes(check.report!, check.context!, pre.issues));
  // Nothing was read, so every planted problem is N/A rather than missed.
  deepEqual(Object.values(ours.planted), ["n/a", "n/a", "n/a", "n/a"]);
});
