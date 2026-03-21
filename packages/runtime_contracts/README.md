# ClawMark Runtime Contracts

Shared desktop/runtime contract entrypoint for `ClawMark Desktop Console`.

This package is the protocol-facing home for:

- desktop bootstrap/process/settings shapes
- runtime dashboard/task/detail snapshots used by the desktop operator surface
- the method catalog for the local desktop control plane

The current implementation re-exports the authoritative runtime types from the main repository source tree so the desktop rollout can move without duplicating truth.
