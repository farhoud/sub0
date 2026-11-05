---
name: review
description: Review source files for bugs by handing each file to a local pi reviewer agent through subzero, then merge the reviewers' replies into one report. Use when the user asks to review code with pi, with the local model, or with subzero reviewers.
argument-hint: "[files or folders, default src/]"
---

# Review code with pi reviewers

Each file is reviewed by a `reviewer` agent: a pi child on a local model,
running its own `code-review` skill. You orchestrate; the reviewers do the
reading. Each reviewer's findings come back to you as the `summary` of its task
result, so there are no review files to read. Do not read the source files
yourself before the results are back.

## 1. Check the setup

Read `.agents/subzero.yaml` in the project. It must define an agent named
`reviewer`. If it does not, stop and tell the user to add one, for example:

```yaml
skills:
  code-review: ../pi-skills/code-review
agents:
  reviewer:
    description: Reviews one source file for bugs.
    host: pi
    model: <provider>/<model>
    thinking: low
    skills: [code-review]
    tools: [read, grep, find, ls]
    timeout: 600
```

## 2. Pick the files

Use the files or folders in the arguments, else `src/`. List them with Glob
(source files only, no lock files, build output or vendored code). If there are
more than 8, review the first 8 and say which were left out.

## 3. Delegate one file per task, without waiting

For each file, call `delegate` with:

- `agent`: `reviewer`
- `wait`: `false`
- `files`: `[<file>]`
- `brief`: `Review <file> using your code-review skill.`
- `expected_output`: `One line per finding: <severity> L<line>: <problem> — <fix>, or "No defects found."`

Start all of them before waiting on any. Tell the user the task ids as they
start, and that they can watch one with `subzero attach <task id>`.

## 4. Collect

Call `await` with all task ids and `timeout_s: 600`. Tasks run one after
another when the endpoint allows one request at a time, so call `await` again
on the ids that are still running until every task has a final status. Report
each task's status as it arrives.

## 5. Merge

- Take each completed task's findings from the `summary` of its result. Do not
  look for files: the reviewers write none.
- For a task that failed, was cancelled, came back truncated or has an empty
  summary, note its task id and status; the user can inspect it with
  `subzero show <task id>`.
- Check each high-severity finding against the source line it cites. Mark a
  finding you disagree with as `disputed` and say why in one sentence.
- Write `REVIEW.md`: one table with File, Line, Severity, Problem, Verdict
  (`confirmed` or `disputed`), then a list of the tasks with their ids, status
  and token use from the results.

End with a short summary for the user: how many files, how many findings by
severity, how many you disputed, and the path of `REVIEW.md`.
