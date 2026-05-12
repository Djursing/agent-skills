---
for: reviewer
lens-version: 1
applies-to: "**/*.css, **/*.scss, **/*.module.css, **/*animation*.ts, **/*animation*.tsx, **/*transition*.ts, **/*transition*.tsx, **/motion/**, **/animations/**"
---

# Animations — Review Lens

## Trigger

Fires when the diff contains `@keyframes`, `transition:`, `animation:`, `motion/react`, `framer-motion`, `startViewTransition`, `@starting-style`, `scroll-timeline`, `view-timeline`, `@lottiefiles`, `@rive-app`, `react-three-fiber`, or any file importing Motion / R3F. Static CSS without motion is out of scope.

## Checklist

- [ ] Animated properties are limited to `transform`, `opacity`, and `filter` — no `width`, `height`, `top`, `left`, `margin`, `padding`, or `box-shadow` animation (these trigger layout/paint and jank).
- [ ] `will-change` is scoped — added before the animation, removed after — not left globally on a hot element (the optimisation reverses if always on).
- [ ] `@media (prefers-reduced-motion: reduce)` block exists for every non-essential animation and is tested (either disable or reduce to a 1-frame state change).
- [ ] Animation duration sits in the 150–500 ms band for UI feedback; durations >500 ms are reserved for narrative / scroll-driven sequences and justified inline.
- [ ] Easing is named (`ease-out`, `cubic-bezier(...)`, or a Motion preset) — not `linear` unless the motion is genuinely constant-velocity (rotation, marquee).
- [ ] SPA / MPA route changes and same-page DOM swaps use the View Transitions API — not manual fade hacks with `setTimeout` and double-render.
- [ ] State morphs (list ↔ cards, full nav ↔ icon-only nav, grid ↔ detail) use Motion `layout` / `layoutId` — never animated `width` / `height` / `top` / `left` directly.
- [ ] Entry-from-hidden animations (modal, popover, dialog) use `@starting-style` + `transition-behavior: allow-discrete` — not `display: none` ↔ `display: block` with `setTimeout`.
- [ ] Hover-revealed effects (glow, glass) animate a pseudo-element's `opacity` — not the host's `box-shadow` or `backdrop-filter` (both are paint-heavy).
- [ ] Lottie / Rive assets are lazy-loaded (dynamic import), paused when off-screen (`IntersectionObserver`), and fall back to a static poster under `prefers-reduced-motion`.
- [ ] React Three Fiber scenes dispose geometries, materials, and textures on unmount (manual `.dispose()` or `<Suspense>` with `<Resource>`); no `useFrame` runs without an `enabled` gate.

## Severity hints

- **Must-fix**: animating layout properties (width/height/top/left/margin); no `prefers-reduced-motion` branch on a non-trivial animation; R3F scene leaking GPU resources.
- **Should-fix**: `will-change` left globally; manual fade hacks instead of View Transitions; state morph via direct layout property animation; `box-shadow` / `backdrop-filter` on hover.
- **Nice-to-have**: easing as `linear` without justification; duration outside the 150–500 ms band; missing lazy-load on Lottie / Rive.
