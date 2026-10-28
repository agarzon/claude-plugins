---
name: tdd
description: Build test-first, red, green, refactor. Use when implementing a feature, a bug fix or a behaviour change in code that has, or should have, tests.
argument-hint: "[the behaviour to build]"
---

# TDD

A test you never saw fail proves nothing. Build in small cycles, one behaviour each.

## Red

- Before writing the test, name the production change that would make it fail. If there is none, the test checks nothing.
- One behaviour per test, named after the behaviour. An "and" in the name means two tests.
- Assert on real behaviour. Mock only what you cannot run (network, clock, paid APIs), and know what the mocked thing does before you fake it.
- Run it and watch it fail **for the right reason**: an assertion on the missing behaviour, not a typo, import error or crash. Passes already? It tests existing behaviour; fix the test.

## Green

- The least code that makes the test pass. No options, parameters or cases the test does not ask for.
- Test still fails? Fix the code, not the test.

## Refactor

- Only on green: remove duplication, improve names. No new behaviour. Re-run after each change.

## Done

Run the project's **whole** suite, not only your file, and show the output. Report every red test by name, including ones you did not cause.

Skip TDD only for throwaway spikes and pure config; say so when you do.
