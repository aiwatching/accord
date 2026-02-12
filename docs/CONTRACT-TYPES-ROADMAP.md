# Contract Types Expansion Roadmap

## Current State
- **External contracts** — `.accord/contracts/*.yaml` → `validate-openapi.sh` (REST API only)
- **Internal contracts** — `.accord/contracts/internal/*.md` → `validate-internal.sh` (flexible markdown, no structured validation)

## Contract Types Needed for Real Microservice Projects

### Priority 1: OpenAPI (REST API) — Already implemented
- Covers REST API service boundaries
- Validation via `validate-openapi.sh` (can use spectral)

### Priority 2: Database Schema Contracts
- **Use case**: Shared databases (common in legacy monolith → microservice migrations)
- **What to define**: Table ownership, cross-service field dependencies, migration compatibility constraints
- **Format options**: SQL DDL, Liquibase/Flyway changelog
- **Validation**: Need custom logic — no off-the-shelf tool like spectral
- **Path**: `.accord/contracts/database/*.sql` or `.accord/contracts/database/*.yaml`

### Priority 3: Message/Event Contracts (AsyncAPI)
- **Use case**: Services communicating via message queue or event bus
- **What to define**: Which service publishes what events, payload schema, consumer expectations
- **Format**: AsyncAPI (same philosophy as OpenAPI but for async messaging)
- **Validation**: AsyncAPI has tooling similar to OpenAPI
- **Path**: `.accord/contracts/events/*.yaml` or `.accord/contracts/async/*.yaml`

### Priority 4: gRPC/Protobuf Contracts
- **Use case**: Inter-service RPC calls
- **What to define**: `.proto` files ARE the contracts
- **Format**: Protocol Buffers `.proto`
- **Validation**: `protoc` compiler, buf lint
- **Path**: `.accord/contracts/grpc/*.proto`

### Priority 5: Shared Library/SDK Contracts
- **Use case**: Services interacting via shared model layer or util libraries
- **What to define**: Public interfaces of shared libraries
- **Validation**: Depends on language — API diff tools exist for Java/Python/TS

### Priority 6: Configuration Contracts
- **Use case**: Environment variables, config items, feature flags that services depend on
- **What to define**: Required config shape, valid values, cross-service config dependencies
- **Format**: JSON Schema or YAML schema
- **Validation**: JSON Schema validators

## Strategy: Gradual Extension
1. `contracts/internal/*.md` is the **universal fallback** — any contract type without structured format goes here first
2. When a pattern stabilizes, upgrade to a dedicated format with structured validation
3. Don't over-design upfront — add contract types when the project actually needs them
4. Contract format definition is easy; **validation logic is the hard part**

## Implementation Notes
- Scanner (`scan.sh`) and validators need to be extensible to handle new contract types
- `init.sh` should auto-detect and scaffold directories for contract types in use
- Each new contract type needs: format spec, template, validator, scanner integration
- Keep the same fractal lifecycle — contract type doesn't change the state machine
