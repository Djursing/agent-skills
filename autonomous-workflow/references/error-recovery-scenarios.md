# Error Recovery Scenarios (Java + Spring + Maven)

Real-world examples of error recovery during autonomous workflow execution.

> **Note on tooling:** Examples use `gw` as the happy path for worktree
> management. Native `git worktree` commands are valid fallbacks.

## Scenario 1: Repeated Test Failure in Authentication Filter

### Context

Implementing JWT authentication in a Spring Security filter.

### Initial failure

```bash
./mvnw -Dtest=JwtAuthenticationFilterTest test
```

```text
Expected status: 401
Actual status: 500
```

### Iteration 1

Analysis: expired token exception is likely uncaught.

```java
// before
Claims claims = jwtParser.parseClaimsJws(token).getBody();
```

Fix attempt: catch `ExpiredJwtException` and return 401.

Result: same test still fails with 500.

### Iteration 2

Analysis: null or malformed Authorization header path still throws before
exception mapping.

Fix attempt: add guard clause for missing/non-Bearer header.

Result: original test passes, but another test fails (missing security context
cleanup).

### Iteration 3

Fix attempt: clear context on error paths.

Result: regression in valid-token test. This hits the same-area cap in Lite
mode (3 attempts), so run stuck-loop protocol.

### Stuck-loop protocol

```text
Skill("confidence", "bug-analysis") -> 71%
```

Confidence < 90% indicates shaky root cause model.

```text
Skill("holistic-analysis")
```

Holistic finding: filter ordering places custom filter before exception
translation, so thrown auth exceptions bypass expected handlers.

Recovery: register filter in correct order and simplify internal catch logic.

Verification:

```bash
./mvnw -Dtest=JwtAuthenticationFilterTest test
./mvnw verify
```

Outcome: all auth tests pass.

---

## Scenario 2: Maven Dependency Resolution Failure

### Context

Adding idempotency persistence introduced a new hashing dependency.

### Failure

```bash
./mvnw -q -DskipTests compile
```

```text
Could not resolve artifact com.acme:hash-utils:1.4.2
```

### Recovery steps

1. Verify coordinates in `pom.xml` (artifact typo found).
2. Retry with metadata refresh:

```bash
./mvnw -U -q -DskipTests compile
```

3. If still failing, validate repository/proxy settings in `settings.xml`.
4. If local cache is corrupted, remove affected directory under
   `~/.m2/repository/com/acme/hash-utils` and retry.

Outcome: compile succeeds after correcting coordinates.

---

## Scenario 3: Spring Context Fails in Integration Tests

### Failure

```bash
./mvnw -Dtest=OrderIdempotencyIT test
```

```text
Failed to load ApplicationContext
Caused by: BeanCreationException: DataSource
```

### Diagnosis

- `@SpringBootTest` uses `application-test.yml`
- Missing test profile DB URL after recent config refactor

### Recovery

1. Restore `spring.datasource.*` test properties.
2. Ensure `@ActiveProfiles("test")` is present.
3. Re-run targeted IT.

```bash
./mvnw -Dtest=OrderIdempotencyIT test
```

4. Run full gate:

```bash
./mvnw verify
```

Outcome: integration tests green.

---

## Scenario 4: CI Failure on Failsafe Integration Stage

### Failure

PR checks show unit tests passing but integration stage failing due to
Testcontainers startup timeout.

### Recovery flow

1. Inspect checks:

```bash
gh pr checks <pr-number>
```

2. Invoke CI companion:

```text
Skill("ci-auto-fix", "<pr-url>")
```

3. Apply minimal fix from logs (increase startup timeout and reuse wait
   strategy used elsewhere in repo).
4. Push and re-watch checks.

If CI still fails and root cause remains unclear after allowed retries,
escalate to user with failure summary and reproduction command.

---

## Pattern Summary

- Prefer targeted reproduction first (`-Dtest=Class#method`).
- Keep fixes minimal and hypothesis-driven.
- Use confidence + holistic-analysis when repeated attempts stop converging.
- Always finish with full verification (`./mvnw verify`) before Phase 6.
