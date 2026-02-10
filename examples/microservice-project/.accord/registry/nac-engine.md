# nac-engine

---
name: nac-engine
type: service
language: java
directory: nac-engine/
contract: .accord/contracts/nac-engine.yaml
---

## Responsibility

Policy evaluation and enforcement engine. Determines whether a device is compliant based on configured policies and device attributes.

## Owns (Data / Domain)

- Policy entities (rules, conditions, actions)
- Evaluation results and compliance state
- Policy templates and rule definitions

## Capabilities

- Evaluate device compliance against policy rules
- CRUD operations for policies
- Query policies by device type, category, or status
- Bulk evaluation for device groups

## Does NOT Own

- Device data → device-manager
- User/role management → nac-admin
- UI rendering → frontend

## Dependencies

- device-manager: query device attributes for policy evaluation
