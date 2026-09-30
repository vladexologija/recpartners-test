# Message contracts between `api/` and `worker/`

`api/` and `worker/` are independent projects, so each defines its own Pydantic models for the
Pub/Sub messages they exchange (docs/design.md D3, D11). This folder holds one example JSON file
per message type, and both projects' tests validate their models against these files, so a change
on one side that the other side does not follow fails a test.

| File | Topic | Published by | Consumed by |
|---|---|---|---|
| `job.json` | `analysis-jobs` | api | worker |
| `event-started.json` | `analysis-events` | worker | api |
| `event-progress.json` | `analysis-events` | worker | api |
| `event-done.json` | `analysis-events` | worker | api |
| `event-failed.json` | `analysis-events` | worker | api |

Every event names its analysis and its `type`. The worker has no database, so `done` also
carries its ffprobe results (duration, size and codec) for the API to store on the video.
