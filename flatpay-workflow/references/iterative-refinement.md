# Iterative Refinement in Autonomous Workflow (Java + Spring)

Examples showing how continuous iteration and self-validation improve code
quality throughout implementation.

> **Scope note — refinement vs. stuck-loop:** Quality refinement is different
> from repeatedly failing the same test. The stuck-loop cap (3 Lite / 5 Full)
> from [`phase-4-testing.md`](../rules/phase-4-testing.md#stuck-loop-detection)
> applies to repeated unresolved failures, not normal iterative polishing.

## Concept

Iterative refinement means improving implementation in small loops with explicit
self-checks:

1. Build a minimal correct version.
2. Run a fast verification command.
3. Review for correctness, clarity, and edge cases.
4. Improve only what is necessary.
5. Re-run focused tests.

---

## Example 1: Retryable HTTP Client for External Billing API

### User request

"Add retry logic for transient billing API failures in `BillingGatewayClient`."

### Iteration 1 (minimal draft)

```java
public BillingResponse charge(BillingRequest request) {
  try {
    return webClient.post().uri("/charges").bodyValue(request)
        .retrieve().bodyToMono(BillingResponse.class).block();
  } catch (Exception e) {
    return webClient.post().uri("/charges").bodyValue(request)
        .retrieve().bodyToMono(BillingResponse.class).block();
  }
}
```

Self-review:

- Compiles: yes
- Correctness: weak (single blind retry)
- Observability: no attempt metadata
- Retry policy clarity: none

Decision: refine before commit.

### Iteration 2 (bounded retry)

```java
private static final int MAX_ATTEMPTS = 3;

public BillingResponse charge(BillingRequest request) {
  RuntimeException last = null;
  for (int attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return invokeCharge(request);
    } catch (RuntimeException ex) {
      last = ex;
      if (attempt == MAX_ATTEMPTS) break;
      sleep(200L * attempt);
    }
  }
  throw last;
}
```

Self-review:

- Bounded retries: yes
- Readability: okay
- Edge case: retries all exceptions, including 4xx semantic errors

Decision: refine to classify retryable failures.

### Iteration 3 (retry policy by status)

```java
private boolean isRetryable(HttpStatusCodeException ex) {
  int status = ex.getStatusCode().value();
  return status == 429 || status >= 500;
}
```

```java
public BillingResponse charge(BillingRequest request) {
  HttpStatusCodeException last = null;
  for (int attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return invokeCharge(request);
    } catch (HttpStatusCodeException ex) {
      if (!isRetryable(ex)) throw ex;
      last = ex;
      if (attempt < MAX_ATTEMPTS) sleep(backoffMs(attempt));
    }
  }
  throw last;
}
```

Self-review:

- Retries only transient conditions: yes
- Backoff present: yes
- Method size and flow: acceptable

Decision: add tests before commit.

### Iteration 4 (tests expose bug)

```java
@Test
void retriesTwiceThenSucceeds() {
  // first two calls throw 503, third succeeds
}
```

```bash
./mvnw -Dtest=BillingGatewayClientTest#retriesTwiceThenSucceeds test
```

Failure shows only 2 total attempts occurred because loop condition was changed
to `< MAX_ATTEMPTS` during refactor.

### Iteration 5 (fix + verify)

Restore `<= MAX_ATTEMPTS`, rerun focused tests, then:

```bash
./mvnw -Dtest=BillingGatewayClientTest test
./mvnw -q -DskipTests compile
```

Commit once behavior and tests are stable.

---

## Example 2: Request Validation Refinement in OrderController

### User request

"Improve validation errors for POST /orders so clients get field-level feedback."

### Iteration 1

- Added `@Valid` to request body.
- Missing explicit exception handler, so responses are inconsistent.

### Iteration 2

- Added `@RestControllerAdvice` with `MethodArgumentNotValidException` handler.
- Response now includes field map, but message keys mismatch API contract.

### Iteration 3

- Aligned error shape with existing API format (`code`, `message`, `details`).
- Extracted mapper method for readability.

### Tests

```java
@WebMvcTest(OrderController.class)
class OrderControllerValidationTest {
  @Test
  void returnsFieldErrorsForInvalidPayload() throws Exception {
    // assert 400 + JSON error payload contract
  }
}
```

```bash
./mvnw -Dtest=OrderControllerValidationTest test
./mvnw verify
```

Result: contract-compliant validation errors with repeatable tests.

---

## Practical Checklist

Before committing a refined change:

- `./mvnw -q -DskipTests compile` passes
- Focused tests for touched behavior pass
- Naming and boundaries are clearer than the first draft
- Edge cases called out in plan are covered
- No repeated edits on same lines without progress

If you repeatedly fail the same test area and attempts stop being meaningfully
different, apply the stuck-loop protocol rather than continuing ad hoc edits.
