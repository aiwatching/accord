# frontend

---
name: frontend
type: service
language: typescript
directory: frontend/
contract: .accord/contracts/frontend.yaml
---

## Responsibility

Web management UI for the NAC system. Renders pages, handles user interactions, and calls backend service APIs.

## Owns (Data / Domain)

- Page layout and component composition
- Client-side routing and navigation state
- UI-specific configuration (themes, preferences)

## Capabilities

- Render device dashboards and admin panels
- Display policy status and evaluation results
- Provide search and filtering UI for all entities

## Does NOT Own

- Device data → device-manager
- Policy data → nac-engine
- User/role data → nac-admin
- Business logic — frontend is a presentation layer only

## Dependencies

- device-manager: fetch device lists, device details, search
- nac-engine: fetch policy status, evaluation results
- nac-admin: fetch user info, role permissions
