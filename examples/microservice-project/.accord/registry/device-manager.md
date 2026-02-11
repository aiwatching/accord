# device-manager

---
name: device-manager
type: service
language: java
directory: device-manager/
contract: .accord/contracts/device-manager.yaml
---

## Responsibility

Device discovery, lifecycle management, and plugin orchestration. Manages the full lifecycle of network devices from discovery through decommission.

## Owns (Data / Domain)

- Device entities (all device data, attributes, status)
- Plugin registry (available device plugins)
- Discovery scan results and history
- Device lifecycle state transitions

## Capabilities

- Device CRUD operations
- Device search and filtering
- Discovery scans (on-demand and scheduled)
- Plugin registration and lookup
- Device lifecycle transitions (discovered → active → decommissioned)

## Does NOT Own

- Policy evaluation → demo-engine
- User management → demo-admin
- UI rendering → frontend

## Dependencies

- demo-engine: notify on device state changes for re-evaluation
