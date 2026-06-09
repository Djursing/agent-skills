# Complete Autonomous Workflow Example (Java + Spring Boot + Maven)

This example demonstrates a full autonomous workflow execution from start to
finish for a backend Spring Boot feature.

> **Note on tooling:** This example uses
> [`gw`](https://github.com/mthines/gw-tools) as the happy path for worktree
> commands. `gw` is optional; native `git worktree` fallback is always valid.

## Scenario

**User request:** "Implement idempotency support for POST /orders"

**Context:**

- Spring Boot application with layered architecture
- Maven wrapper available (`./mvnw`)
- Existing `OrderController`, `OrderService`, and JPA repositories
- Goal: prevent duplicate order creation on retries

---

## Phase 0: Validation

### Agent confirmation

```markdown
Current understanding:

- Add idempotency support to `POST /orders`
- Client sends `Idempotency-Key` header
- If same key is reused with same payload, return prior successful response
- If same key is reused with different payload, return conflict

Questions:

1. Retention period for idempotency keys?
2. Scope: per user or global?
3. Conflict status code preference (`409` vs `422`)?
4. Persist full response body or stable order identifier?

Proposed default:

- Scope per authenticated user
- Retention 24h
- Conflict `409`
- Persist order id + response checksum
```

User confirms defaults.

---

## Phase 1: Planning

### Mode selection

```text
MODE SELECTION:
- Mode: Full
- Reasoning: Cross-cutting API + service + persistence + tests
- Estimated files: 8
- Complexity: architectural
```

### Technical plan (summary)

```markdown
1. Add idempotency entity + repository
   - src/main/java/com/acme/orders/idempotency/IdempotencyRecord.java
   - src/main/java/com/acme/orders/idempotency/IdempotencyRecordRepository.java

2. Add service orchestration
   - src/main/java/com/acme/orders/OrderService.java
   - Introduce createOrReplayOrder(...)

3. Wire controller header handling
   - src/main/java/com/acme/orders/OrderController.java

4. Add DB migration for idempotency table + indexes
   - src/main/resources/db/migration/V42__add_idempotency_records.sql

5. Add tests
   - unit: OrderServiceTest
   - slice: OrderControllerTest (@WebMvcTest)
   - integration: OrderIdempotencyIT (@SpringBootTest)

Verification commands:
- After edit: ./mvnw -q -DskipTests compile
- Focused: ./mvnw -Dtest=OrderServiceTest test
- Before PR: ./mvnw verify
```

### Confidence gate

```text
Skill("confidence", "plan")
-> 93% (pass)
```

---

## Phase 2: Worktree Setup

```bash
$ gw add feat/order-idempotency
$ gw cd feat/order-idempotency
$ ./mvnw -q -DskipTests compile
```

Generate plan artifact:

```text
Skill("aw-create-plan")
-> Wrote .agent/feat-order-idempotency/plan.md
```

Progress log excerpt:

```markdown
- [2026-05-08T10:12:04Z] Phase 2: worktree created (gw add feat/order-idempotency)
- [2026-05-08T10:12:39Z] Phase 2: compile verified via ./mvnw -q -DskipTests compile
- [2026-05-08T10:13:02Z] Phase 2: aw-create-plan invoked (plan.md generated)
```

---

## Phase 3: Implementation

### Representative changes

```java
// src/main/java/com/acme/orders/OrderController.java
@PostMapping("/orders")
public ResponseEntity<OrderResponse> createOrder(
    @RequestHeader("Idempotency-Key") String idempotencyKey,
    @Valid @RequestBody CreateOrderRequest request,
    Principal principal
) {
  OrderResponse response = orderService.createOrReplayOrder(
      principal.getName(), idempotencyKey, request);
  return ResponseEntity.status(HttpStatus.CREATED).body(response);
}
```

```java
// src/main/java/com/acme/orders/OrderService.java
@Transactional
public OrderResponse createOrReplayOrder(String userId, String key, CreateOrderRequest request) {
  Optional<IdempotencyRecord> existing = idempotencyRepository.findByUserIdAndKey(userId, key);
  if (existing.isPresent()) {
    return existing.get().toOrderResponseOrThrowConflict(request);
  }

  Order order = createOrderInternal(request, userId);
  idempotencyRepository.save(IdempotencyRecord.from(userId, key, request, order));
  return OrderResponse.from(order);
}
```

Fast checks after edits:

```bash
./mvnw -q -DskipTests compile
```

Companion example:

```text
Skill("code-quality", "code")
-> Suggested extracting conflict validation helper (applied)
```

---

## Phase 4: Testing

Focused loop:

```bash
./mvnw -Dtest=OrderServiceTest#reusesResponseWhenSameKeyAndPayload test
./mvnw -Dtest=OrderServiceTest#returnsConflictWhenSameKeyDifferentPayload test
./mvnw -Dtest=OrderControllerTest test
```

Integration gate:

```bash
./mvnw -Dtest=OrderIdempotencyIT test
./mvnw verify
```

Acceptance criteria mapping excerpt:

```markdown
- AC1 "same key + same payload returns existing order" -> OrderServiceTest#reusesResponseWhenSameKeyAndPayload
- AC2 "same key + different payload returns 409" -> OrderServiceTest#returnsConflictWhenSameKeyDifferentPayload
- AC3 "controller requires Idempotency-Key" -> OrderControllerTest#rejectsMissingHeader
```

---

## Phase 5: Documentation

Updated:

- `README.md`: added idempotency contract and example headers
- `CHANGELOG.md`: feature entry

Companion example:

```text
Skill("update-claude")
-> Updated CLAUDE.md guidance for idempotency key conventions
```

---

## Phase 6: PR Creation

Pre-flight:

```bash
git status
./mvnw verify
```

Companions:

```text
Skill("review-changes")
Skill("aw-create-walkthrough")
Skill("create-pr")
```

Example PR summary:

```markdown
## Summary
- Add idempotency record persistence and service orchestration for POST /orders.
- Replay prior successful response for duplicate key+payload requests.
- Return 409 for duplicate key with conflicting payload.
```

---

## Phase 7: CI Gate

Monitor checks and auto-fix if needed:

```text
gh pr checks <pr-number>
Skill("ci-auto-fix", "<pr-url>")
```

If green, hand off for review/merge. Worktree cleanup is optional post-merge.

---

## Outcome

- Requirements validated and captured in `plan.md`
- Implementation completed with compile/test verification loops
- Acceptance criteria mapped to concrete JUnit tests
- Draft PR opened with walkthrough and CI gate run
