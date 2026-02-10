# Accord Example: next-nac Microservice Project

This example demonstrates a realistic Accord setup for a Network Access Control (NAC) system using the **monorepo** model with centralized `.accord/` structure.

## Services

| Service | Description |
|------|-------------|
| `frontend` | Web management UI (BFF pattern) |
| `nac-engine` | Policy evaluation and enforcement engine |
| `device-manager` | Device discovery, lifecycle, and plugin management |
| `nac-admin` | Administration, RBAC, and audit logging |

## Sub-Modules (device-manager)

The `device-manager` service has three internal modules with their own interface contracts:

| Module | Description |
|--------|-------------|
| `plugin` | Plugin registry for device type handlers |
| `discovery` | Network device discovery service |
| `lifecycle` | Device state and lifecycle management |

## Directory Layout

```
examples/microservice-project/
├── .accord/
│   ├── config.yaml                             # Project config (4 services, modules nested)
│   ├── contracts/
│   │   ├── nac-engine.yaml                     # 4 endpoints, stable
│   │   ├── device-manager.yaml                 # 3 endpoints, stable
│   │   ├── frontend.yaml                       # Minimal BFF, stable
│   │   ├── nac-admin.yaml                      # 3 endpoints, one proposed
│   │   └── internal/
│   │       ├── plugin.md                       # PluginRegistry Java interface
│   │       ├── discovery.md                    # DiscoveryService Java interface
│   │       └── lifecycle.md                    # DeviceLifecycleManager Java interface
│   └── comms/
│       ├── PROTOCOL.md                         # Condensed protocol rules
│       ├── TEMPLATE.md                         # Request template
│       ├── inbox/
│       │   ├── frontend/                       # (empty)
│       │   ├── nac-engine/                     # (empty)
│       │   ├── device-manager/                 # (empty)
│       │   ├── nac-admin/
│       │   │   └── req-002-rbac-permissions.md # Pending request from frontend
│       │   ├── plugin/                         # (empty)
│       │   ├── discovery/                      # (empty)
│       │   └── lifecycle/                      # (empty)
│       └── archive/
│           └── req-001-policy-by-type.md       # Completed request
└── README.md                                   # This file
```

## Walkthrough: Completed Request (req-001)

This example includes a completed request showing the full lifecycle:

1. **device-manager** needed a "get policies by device type" API from **nac-engine**
2. Created `req-001-policy-by-type.md` in `.accord/comms/inbox/nac-engine/`
3. nac-engine service approved and implemented the endpoint
4. Request was moved to `.accord/comms/archive/` with status `completed`
5. The endpoint is now in `.accord/contracts/nac-engine.yaml` (stable, no annotations)

## Walkthrough: Pending Request (req-002)

There is also a pending request in progress:

1. **frontend** needs RBAC permission checking from **nac-admin**
2. Created `req-002-rbac-permissions.md` in `.accord/comms/inbox/nac-admin/`
3. The proposed endpoint is annotated in `.accord/contracts/nac-admin.yaml` with `x-accord-status: proposed`
4. Waiting for nac-admin service to review and approve

## How to Use This Example

1. Study the directory structure to understand the centralized `.accord/` layout
2. Read `.accord/config.yaml` to see project configuration (services + modules in one file)
3. Read the contracts in `.accord/contracts/` to see external API boundaries
4. Read the internal contracts in `.accord/contracts/internal/` to see module-level boundaries
5. Compare `req-001` (completed) and `req-002` (pending) to understand the request lifecycle
