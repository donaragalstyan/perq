---
inclusion: always
---

# perq — Product Principles

## What perq is

perq is a location-based platform that helps students discover in-person student
discounts they are **actually likely to qualify for** with the credentials they hold.

It was born from a lived experience: an American university student traveling in
the Czech Republic, Austria, and Slovakia discovered that a physical U.S. university
ID was accepted for student discounts in many places — with no way to know beforehand
where it would work.

## The north-star question

perq does not answer "Where are there student discounts?"

perq answers:

> **"Which student discounts near me am I actually likely to qualify for with the
> student credentials I have?"**

Every feature must serve that question. If a feature does not help a student find,
trust, or act on a discount they can personally use, it is out of scope for the MVP.

## Framing: financial accessibility, not deal-hunting

perq is about **student financial accessibility**. Students — especially those studying
or traveling abroad on tight budgets — miss money they are entitled to because the
information is scattered and untrustworthy. We build for the student who cannot afford
to guess wrong at the counter, not for the bargain hunter.

## Trust is the product

A student-discount app that confidently says "yes, your ID works here" and is wrong is
worse than useless: it causes real-world embarrassment and erodes trust permanently.

Therefore:

- We would rather show **fewer** discounts we are confident about than more we are not.
- When in doubt, we **fail toward "unknown"**, never toward a confident wrong answer.
- Eligibility is a conservative, **explainable** signal, never a confident binary guess.

## Eligibility is a three-state, explainable signal

perq never tells a user a flat "yes." It surfaces one of:

- **LIKELY** — the user's held credentials match the discount's accepted methods.
- **ADDITIONAL_REQUIREMENTS** — may qualify, but conditions apply (country, specific
  credential, age, etc.).
- **UNKNOWN** — insufficient evidence to say.

Every signal carries a short human-readable **reason**.

## MVP scope guardrails

- Two hero cities for seeded, demoable data: **Seattle** and **Prague**. The schema
  must support more (Vienna, Bratislava, eventually international) without redesign.
- One excellent, polished, technically interesting core product beats twenty
  half-working features.
- Autonomous AI discovery is **not** in the MVP. A single bounded, human-gated
  extraction endpoint is.

## Deadline reality

Solo developer. Submission due **October 23, 2026, 11:59 PM PST** (verify against the
official contest terms). Scope every decision against that constraint.
