# North Star

Status: Current
Owner: Krish Raja
Last verified: 2026-10-18

> Through 2027, everyone in the family, wherever they are, knows exactly where Dad's care stands and what to ask next, from evidence, without a frantic phone call.
>
> By 31 December 2026, Kimon uses Beside himself every week to track his own heart health, and his cardiologist finds his notes useful.

Set by Krish on 18 October 2026. It is not reached yet. It is what every session in this repository works toward.

## The number

**Times a week Kimon adds something to Beside himself**: 4 by 28 December 2026, on a linear weekly ladder. Checkpoints: 16 Nov 2026: 2; 14 Dec 2026: 4; 28 Dec 2026: 4.

```yaml north-star-metric
metric: "Times a week Kimon adds something to Beside himself"
unit: count
direction: up
target: 4
deadline: 2026-12-28
ladder_shape: linear
source: "Beside entries attributed to Kimon by the server"
status: active
ladder:
  - [2026-10-26, 1]
  - [2026-11-02, 1]
  - [2026-11-09, 2]
  - [2026-11-16, 2]
  - [2026-11-23, 2]
  - [2026-11-30, 3]
  - [2026-12-07, 3]
  - [2026-12-14, 4]
  - [2026-12-21, 4]
  - [2026-12-28, 4]
```

Urgency (U1 to U5) is worked out every week from where the number stands against that week's target, by [the harness contract](https://github.com/krishanraja/ai-harness/blob/main/contract/north-star-metric.md). Set by Krish on 23 October 2026.

## How to use it

- Read it before any work, every session.
- Before you start, say which part of it the task moves. If the task moves nothing toward it, say so first and let Krish decide.
- Prefer the work that moves it furthest, and close each session by noting what moved.
- Only Krish changes this file. Record his ruling in the commit body as `Ruling (Krish, YYYY-MM-DD): ...`.
- When it is reached, say so and ask Krish for the next one.
