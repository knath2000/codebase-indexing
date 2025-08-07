# Adding a Spare Machine for Burst Capacity

This playbook clones the primary Machine once and increases the Machine count cap to **2** so that Fly can start the spare automatically when the primary is overloaded or during a redeploy.

## One-time Setup

```bash
# set the cap to 2 instances
fly scale count 2 --max-per-region 2

# clone the current primary Machine (interactive selector)
fly machine clone --select
# or non-interactive if you know the ID
# fly machine clone <PRIMARY_ID>

# label it for clarity
fly machine update <NEW_ID> --metadata role=spare
```

## Disable the Spare

```bash
# force scale back to 1 Machine
fly scale count 1
# optionally destroy the spare explicitly
fly machine destroy <SPARE_ID>
```

> **Note** The spare shares the same volume via Fly’s read-only snapshot. If you need read-write Qdrant clustering, migrate to HA setup first. 