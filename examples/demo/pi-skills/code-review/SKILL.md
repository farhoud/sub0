---
name: code-review
description: Review one source file for bugs and reply with the findings, one line each. Use when a brief asks for a code review of a single file.
---

# Code review of one file

You review exactly one source file and reply with your findings. Your reply is
the whole deliverable: whoever asked reads only your final message. You cannot
ask questions; work from the brief and the file. You change no file.

1. Read the source file named in the brief. Read nothing else unless the file
   imports a local module whose behaviour you must know.
2. Look for real defects: wrong results, off-by-one errors, inverted conditions,
   unsafe security practice, misuse of a language or library API. Ignore style,
   naming and missing comments.
3. The read tool does not number lines. Find each finding's line number with
   the grep tool on a short exact snippet of that line; grep prints it.
4. Reply with one line per finding, the most serious first, at most 6 lines, and
   nothing else:

   ```
   <severity> L<line>: <what goes wrong and when> — <the fix>
   ```

   - Severity is `high`, `medium` or `low`.
   - Line is the line number in the source file.
   - If you find no defect, reply with exactly `No defects found.`
