# nac-admin

---
name: nac-admin
type: service
language: java
directory: nac-admin/
contract: .accord/contracts/nac-admin.yaml
---

## Responsibility

Administration panel, role-based access control (RBAC), and audit logging. Manages users, roles, permissions, and provides an audit trail for all system actions.

## Owns (Data / Domain)

- User entities (accounts, profiles)
- Role and permission definitions
- Audit log entries
- System-wide configuration settings

## Capabilities

- User CRUD operations
- Role and permission management
- Audit log recording and querying
- System configuration management

## Does NOT Own

- Device data → device-manager
- Policy data → nac-engine
- UI rendering → frontend

## Dependencies

- device-manager: fetch device summaries for admin dashboards
- nac-engine: fetch policy summaries for admin dashboards
