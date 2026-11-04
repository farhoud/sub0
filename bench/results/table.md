Design revision `52ebee356c4c2efb93cec157ca609ba9caabc83219481875d494ebc951fb4fa9`; Claude model and effort claude-sonnet-5-5 / high.

| Pass | Arm | Status | `booking-pending-range-contradiction` | `booking-rooms-archived-mark-ownership` | `calendar-display-name-unmet-obligation` | `calendar-owner-digest-unreached-step` | Extra findings | Ingest state | Re-asks | Unread units | Main tokens | Evaluator tokens | Interpreter tokens | Wall time | Interpreter context at settle | Thinking (launch spec) | Stray writes | Notes |
| --- | --- | --- | --- | --- | --- | --- | ---: | --- | ---: | ---: | --- | --- | --- | ---: | --- | --- | --- | --- |
| 2026-11-04T06-27-47-390Z-B | B | failed | found | found | found | found | 68 | disjoint | 6 | 1 | 35,913 (in 2, cache 0+35,895, out 16) | 2,157,076 (in 64, cache 1,123,041+1,007,804, out 26,167) | 2,301,762 (in 2,021,810, cache 0+0, out 279,952) | 8159 s | max 90,051 of 13 | high | none | claude -p timed out; the run ended without the evaluator's report; Claude models seen: claude-sonnet-5-5; interpreter models seen: Qwen3.8 |
| 2026-11-04T09-07-17-899Z-B-low | B-low | completed | N/A | N/A | found | found | 96 | disjoint | 7 | 80 | 64,934 (in 4, cache 0+64,911, out 19) | 2,299,958 (in 78, cache 1,453,274+821,827, out 24,779) | 3,808,800 (in 3,616,177, cache 0+0, out 192,623) | 7844 s | max 67,331 of 14 | low | none | handed back disjoint; Claude models seen: claude-sonnet-5-5; interpreter models seen: Qwen3.8 |

| Arm | Passes (completed) | `booking-pending-range-contradiction` | `booking-rooms-archived-mark-ownership` | `calendar-display-name-unmet-obligation` | `calendar-owner-digest-unreached-step` |
| --- | --- | --- | --- | --- | --- |
| B | 1 (0) | 1/1 | 1/1 | 1/1 | 1/1 |
| B-low | 1 (1) | 0/0 (1 N/A) | 0/0 (1 N/A) | 1/1 | 1/1 |
