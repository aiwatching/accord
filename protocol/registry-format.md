# Module Registry Format

Version: 0.1.0-draft

The Module Registry provides a lightweight directory of what each service/module owns and does. Agents use it for **task routing** — deciding which module to modify or request changes from.

---

## Location

Registry files live at `.accord/registry/{name}.md` — one per service or module.

## Required Fields (YAML frontmatter)

| Field       | Description                                        | Example                         |
|------------|----------------------------------------------------|---------------------------------|
| `name`     | Service or module name                             | `device-manager`                |
| `type`     | `service` or `module`                              | `service`                       |
| `language` | Primary language                                   | `java`                          |
| `directory`| Path to source code                                | `device-manager/`               |
| `contract` | Path to the contract file                          | `.accord/contracts/device-manager.yaml` |

## Required Sections

| Section            | Purpose                                                        |
|-------------------|----------------------------------------------------------------|
| **Responsibility** | 1-2 sentence summary of what this module does                  |
| **Owns**           | Data entities and domains this module is the source of truth for |
| **Capabilities**   | What this module can do (list of actions/operations)           |
| **Does NOT Own**   | What this module is NOT responsible for, with pointers to the owner |
| **Dependencies**   | Other modules this module depends on and why                   |

## How Agents Use It

1. **Task routing**: Before implementing a feature, read registry files to find which module owns the data involved.
2. **Request targeting**: When creating a cross-boundary request, the registry tells you which module to target.
3. **Dispatch planning**: When dispatching subagents for a multi-module feature, the registry defines the scope of each subagent.
