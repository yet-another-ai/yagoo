# Yagoo Python utilities

Managed with **uv** under **mise** (`mise run python:sync`).

Intended later uses:

- Load KataGo SWA `.ckpt` checkpoints
- Extract `scorebelief`, `seki`, `futurepos`, and trunk activations
- Train concept heads on a frozen trunk

Nothing is implemented yet — `pyproject.toml` is an empty uv project (`package = false`). Keep heavy PyTorch / KataGo Python deps out of the default environment until the sidecar spike starts.
