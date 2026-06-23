#!/usr/bin/env bash
# Create the three sibline streams. Idempotent-ish: `nats stream add` errors if
# the stream exists; use `nats stream info <name>` to check first in re-runs.
set -euo pipefail
CTX="${NATS_CONTEXT:-sibline}"   # a `nats context` with url+creds preset
for agent in kukla ollie; do
  nats --context "$CTX" stream add "sibline-$agent" \
    --subjects "sibline.$agent.>" \
    --storage file --retention limits \
    --max-age 7d --max-msgs 10000 --max-msg-size 1MB \
    --discard old --dupe-window 2m --replicas 1 --defaults
done
nats --context "$CTX" stream add sibline-broadcast \
  --subjects "sibline.broadcast" \
  --storage file --retention limits \
  --max-age 7d --max-msgs 10000 --max-msg-size 1MB \
  --discard old --dupe-window 2m --replicas 1 --defaults
