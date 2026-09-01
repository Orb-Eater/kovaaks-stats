# Score-by-cm interpretation rules

Plain text on purpose — edit this file, no code changes needed. The app reads
the headings and the `WHEN:` lines; everything else is shown to the user as-is.

Format per entry:

```
### <Category> / <Sub-category>
WHEN: <condition>
=> <what it means>
```

Conditions available, joined with `AND`:

| condition | true when |
|---|---|
| `faster_than(cm)` | your best-scoring level is **faster** than this (a smaller cm number) |
| `slower_than(cm)` | your best-scoring level is **slower** than this (a bigger cm number) |
| `higher_avg_at_faster` | some level faster than your most-played one scores higher than it |
| `higher_avg_at_slower` | some level slower than your most-played one scores higher than it |
| `pct_below_regular(n)` | some level averages at least n% below your most-played one |
| `regular_slower_than(cm)` | the sensitivity you play most is slower than this |

**cm/360 is distance per turn, so a bigger number is a slower sensitivity.**
80cm is slower than 45cm. Everything above reads that way.

A level needs **10+ runs** before it is drawn or used in any rule — comparing a
three-run level against a two-hundred-run one is not a comparison. Extremes
below 25cm and above 80cm are excluded by default (toggleable).

An entry whose rule or interpretation still says `(add your ...)` is treated as
a template and never shown. A condition the app does not recognise is reported
back in the panel rather than silently ignored.

---

## 1. Static Clicking

### Static Clicking / Micro
WHEN: higher_avg_at_faster
=> Normally the faster the cm, the lower the score. Scoring higher on a faster
   cm than your regular cm points to a lack of forearm use.

WHEN: regular_slower_than(80) AND pct_below_regular(50)
=> If your regular sens is slower than 80cm you should not be scoring highly on
   much faster cm. A score 50% below your regular cm suggests you lack stability
   and micro speed at high precision.

### Static Clicking / Wide
WHEN: (add your rule)
=> (add your interpretation)

### Static Clicking / Regular
WHEN: (add your rule)
=> (add your interpretation)

## 2. Dynamic Clicking

### Dynamic Clicking / Micro
WHEN: (add your rule)
=> (add your interpretation)

### Dynamic Clicking / Wide
WHEN: (add your rule)
=> (add your interpretation)

### Dynamic Clicking / Regular
WHEN: faster_than(50)
=> Scores higher at cm faster than 50cm on dynamic clicking means:
   (add your interpretation)

WHEN: slower_than(50)
=> Scores higher at cm slower than 50cm on dynamic clicking means:
   (add your interpretation)

## 3. Control Tracking

### Control Tracking / Control Paradise
Median cm for this scenario among the top 25 players is **56.5cm**.

WHEN: slower_than(58)
=> A PB/avg that keeps improving above 58cm means you're lacking in wrist and arm stability, play more micro scenarios at 50cm.

WHEN: faster_than(52)
=> A PB/avg higher below 52cm means you lack wrist and arm movements, you should play control  and smoothness scenarios at 50cm or slower..

WHEN: faster_than(52) AND pct_below_regular(0) at slower cm
=> If your scores fall away substantially past 58cm, you lack arm
   stability/reading ability and need more practice at slower cm.

WHEN: slower_than(58) AND scores fall toward 20cm
=> Scores dropping steadily as cm approaches 20cm means you lack wrist and micro
   stability/reading ability.

## 4. Smoothness

### Smoothness
WHEN: (add your rule)
=> (add your interpretation)

## 5. Reactive

### Reactive
WHEN: (add your rule)
=> (add your interpretation)
