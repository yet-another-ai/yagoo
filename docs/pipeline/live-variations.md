# Live variations

The reviewer can analyze one tried position with either a staged browser model
or the connected native engine. Click **Try**, play an empty intersection or
**Pass**, and use the tree to revisit a node. The move inspector, candidate
ghosts, numbered PV preview and ownership paint use that node's engine snapshot.
The game graph and recorded main-line results remain separate.

## Request and result

`PositionAnalysisRequest` carries `{ sgf, ply, moves, visits }`. `sgf` is the
selected SGF ancestry as one line, including root setup, player, rules, komi
and all moves through the anchor. `ply` counts moves through that anchor.
`moves` contains every tried move from the anchor, in GTP notation, including
`pass`. The default reviewer budget is 200 visits.

Both backends call `yagoo_pipeline::analyze_position`. Native receives this
request through `POST /analyze-position`; the browser passes it to the
`analyze_position` WASM export inside the engine worker. The shared helper
replays setup and full move history before searching. It emits one standard
`positionCompleted` event with `snapshot.ply = ply + moves.length`, root
analysis, candidates and ownership, then ends. It does not run a game scan,
pass probe, teaching-group calculation, or commentary generation.

Missing rules use Chinese, matching the game pipeline. Root `PL` is respected.
Unsupported mid-game setup, rules or player edits are reported as errors rather
than silently analyzing a different board. Existing browser rule limitations,
including Japanese encore, still apply.

## History and lifecycle

The local board retains the anchor's replayed position and positional history.
It checks occupancy, suicide, simple ko, and Chinese positional superko. Passes
advance the player and clear simple ko without deleting the repetition history.
Selecting an SGF sibling serializes that sibling's actual ancestry. The try tree
renders parent-first, and choosing an existing child reuses that node.

Each variation has a separate `AnalysisState`. Completed results can be revisited;
**Analyze position** explicitly reruns the selected node. Moving elsewhere,
changing engines, loading another SGF or closing the reviewer stops the previous
request. Generation guards discard late events, errors and completion callbacks.
The browser stop path also wakes iterators waiting for worker events.

With no live source, legal branch exploration still works and the reviewer
explains how to load or connect an engine. It does not display main-line
candidates as if they described a tried position.

Tests use explicitly controlled adapters and fixture events for lifecycle and
display assertions. They cover ko, pass, ancestry, branching, rapid navigation,
cancellation, unmount, stale results, PV and ownership. CI does not download
models or enforce performance thresholds.
