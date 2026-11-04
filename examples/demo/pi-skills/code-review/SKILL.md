---
name: code-review
description: Review one source file for bugs and write the findings to the review file the brief names. Use when a brief asks for a code review of a single file.
---

# Code review of one file

You review exactly one source file and write one review file. You cannot ask
questions; work from the brief and the file.

1. Read the source file named in the brief. Read nothing else unless the file
   imports a local module whose behaviour you must know.
2. Look for real defects: wrong results, off-by-one errors, inverted conditions,
   unsafe security practice, misuse of a language or library API. Ignore style,
   naming and missing comments.
3. The read tool does not number lines. Find each finding's line number with
   the grep tool on a short exact snippet of that line; grep prints it.
4. Write the review file the brief names, with the write tool, in exactly this
   form and nothing else:

   ```markdown
   # Review: <source path>

   | Line | Severity | Problem | Fix |
   | ---: | --- | --- | --- |
   | 12 | high | One sentence on what goes wrong and when. | One sentence on the change. |
   ```

   - At most 6 rows, the most serious first. Severity is `high`, `medium` or `low`.
   - Line is the line number in the source file.
   - If you find no defect, write the heading and the line `No defects found.`
5. Write only that one file. Never change the source file.
6. Reply with one line per finding: `<severity> L<line>: <problem>`, then stop.
