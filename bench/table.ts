// @sigil implements design/spike-harness.sigil SpikeHarness (table and results document)
//
// One measurement row per pass, failed passes kept. No threshold applies: the
// decision is the user's, written in the spike results document.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { ARMS, isUnavailable, type Measure, type MeasurementRow, type TokenUsage } from "./types.ts";

export const TABLE_START = "<!-- spike-table:start -->";
export const TABLE_END = "<!-- spike-table:end -->";

export function appendRow(rowsFile: string, row: MeasurementRow): void {
  appendFileSync(rowsFile, JSON.stringify(row) + "\n");
}

export function readRows(rowsFile: string): MeasurementRow[] {
  if (!existsSync(rowsFile)) return [];
  return readFileSync(rowsFile, "utf8").split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l));
}

function cell(value: unknown): string {
  return String(value ?? "").replaceAll("|", "\\|").replaceAll("\n", " ");
}

/** A measure, or "unavailable (reason)": never a zero in its place. */
export function show(value: Measure | string): string {
  if (isUnavailable(value)) return `unavailable (${cell(value.unavailable)})`;
  return typeof value === "number" ? value.toLocaleString("en-US") : cell(value);
}

function tokens(usage: TokenUsage): string {
  if (isUnavailable(usage.total)) return show(usage.total);
  return `${show(usage.total)} (in ${show(usage.input)}, cache ${show(usage.cacheRead)}+${show(usage.cacheWrite)}, out ${show(usage.output)})`;
}

const MARK = { found: "found", missed: "missed", "n/a": "N/A", unscored: "unscored" } as const;

function contextAtSettle(values: Measure[]): string {
  if (values.length === 0) return "—";
  const known = values.filter((v): v is number => typeof v === "number");
  const missing = values.length - known.length;
  if (known.length === 0) return show(values[0]);
  return `max ${Math.max(...known).toLocaleString("en-US")} of ${values.length}${missing ? ` (${missing} unavailable)` : ""}`;
}

export function renderTable(rows: MeasurementRow[]): string {
  if (rows.length === 0) return "No passes recorded yet.\n";
  const issues = [...new Set(rows.flatMap((r) => Object.keys(r.planted)))];
  const lines: string[] = [];

  const revisions = new Set(rows.map((r) => r.designRevision));
  const setups = new Set(rows.map((r) => `${r.claudeModel} / ${r.effort ?? "default"}`));
  if (revisions.size > 1) lines.push(`> **Warning:** the passes ran on ${revisions.size} design revisions; they are not comparable.`, "");
  if (setups.size > 1) lines.push(`> **Warning:** the passes used different Claude models or efforts: ${[...setups].join(", ")}.`, "");
  if (rows.length > 0) {
    lines.push(`Design revision \`${[...revisions][0]}\`; Claude model and effort ${[...setups].join(", ")}.`, "");
  }

  lines.push(
    `| Pass | Arm | Status | ${issues.map((i) => `\`${i}\``).join(" | ")} | Extra findings | Ingest state | Re-asks | Unread units | Main tokens | Evaluator tokens | Interpreter tokens | Wall time | Interpreter context at settle | Thinking (launch spec) | Stray writes | Notes |`,
    `| --- | --- | --- | ${issues.map(() => "---").join(" | ")} | ---: | --- | ---: | ---: | --- | --- | --- | ---: | --- | --- | --- | --- |`,
  );
  for (const r of rows) {
    const notes: string[] = [];
    if (r.failure) notes.push(r.failure);
    if (r.checkErrors.length) notes.push(`check: ${r.checkErrors.join("; ")}`);
    if (r.untrustworthy) notes.push("**score untrustworthy: an interpreter wrote into the claims store**");
    if (r.mainConversationClean === false) notes.push("main conversation loaded sigil material");
    if (r.arm.startsWith("B") && r.interpreterRuns.viaAgentTool > 0) notes.push(`${r.interpreterRuns.viaAgentTool} interpreters via the Agent tool`);
    if (r.handbackState !== null) notes.push(`handed back ${r.handbackState}`);
    for (const unchecked of r.writesUnchecked ?? []) notes.push(`writes unchecked: ${unchecked}`);
    for (const other of r.otherSubagents ?? []) notes.push(`other subagent ${other.agentType}: ${tokens(other.tokens)}`);
    const observed = r.observedModels ? [...new Set([...r.observedModels.main, ...r.observedModels.evaluator])] : [];
    if (observed.length > 0) notes.push(`Claude models seen: ${observed.join(", ")}`);
    if (r.observedModels?.interpreters.length) notes.push(`interpreter models seen: ${r.observedModels.interpreters.join(", ")}`);
    const stray = r.strayWrites.length === 0
      ? "none"
      : `**${r.strayWrites.length}**: ${r.strayWrites.map((w) => `\`${w.path}\``).join(", ")}`;
    lines.push(
      `| ${cell(r.pass)} | ${r.arm} | ${r.status} | ${issues.map((i) => MARK[r.planted[i] ?? "unscored"]).join(" | ")} | ${show(r.extraFindings)} | ${show(r.ingestState)} | ${show(r.reAsks)} | ${show(r.unreadUnits)} | ${tokens(r.tokens.main)} | ${tokens(r.tokens.evaluator)} | ${tokens(r.tokens.interpreters)} | ${Math.round(r.wallTimeMs / 1000)} s | ${contextAtSettle(r.interpreterContextAtSettle)} | ${r.thinkingLevels.length ? [...new Set(r.thinkingLevels.map((t) => show(t)))].join(", ") : "—"} | ${stray} | ${cell(notes.join("; ")) || "—"} |`,
    );
  }

  // Per arm: how often each planted problem was found among the passes that read it.
  lines.push("", "| Arm | Passes (completed) | " + issues.map((i) => `\`${i}\``).join(" | ") + " |");
  lines.push("| --- | --- | " + issues.map(() => "---").join(" | ") + " |");
  for (const arm of ARMS) {
    const armRows = rows.filter((r) => r.arm === arm);
    if (armRows.length === 0) continue;
    const completed = armRows.filter((r) => r.status === "completed").length;
    const cells = issues.map((issue) => {
      const scored = armRows.filter((r) => r.planted[issue] === "found" || r.planted[issue] === "missed");
      const found = scored.filter((r) => r.planted[issue] === "found").length;
      const na = armRows.filter((r) => r.planted[issue] === "n/a").length;
      return `${found}/${scored.length}${na ? ` (${na} N/A)` : ""}`;
    });
    lines.push(`| ${arm} | ${armRows.length} (${completed}) | ${cells.join(" | ")} |`);
  }
  return lines.join("\n") + "\n";
}

/** Replace the table between the markers of the results document, leaving the rest untouched. */
export function updateResultsDocument(docFile: string, table: string): void {
  const doc = readFileSync(docFile, "utf8");
  const start = doc.indexOf(TABLE_START);
  const end = doc.indexOf(TABLE_END);
  if (start === -1 || end === -1 || end < start) throw new Error(`${docFile} lacks the table markers`);
  writeFileSync(docFile, `${doc.slice(0, start + TABLE_START.length)}\n\n${table}\n${doc.slice(end)}`);
}
