---
status: testing
phase: 03-cjk-typography-differentiation
source: [03-VERIFICATION.md]
started: 2026-07-16T04:00:00Z
updated: 2026-07-16T04:00:00Z
---

## Current Test

number: 1
name: Desktop Aa 中文排版 section order and live toggles
expected: |
  Section order 主题 → 中文排版 → 字体; three switches default ON; info popovers show plain 简体中文; live apply without 应用 button.
awaiting: user response

## Tests

### 1. Desktop Aa 中文排版 section
expected: Section after 主题 before 字体; labels 标点挤压/盘古之白/禁则; info a11y 关于*; live onPrefsChange
result: [pending]

### 2. Desktop render CJK effects
expected: Capable engine shows trim/autospace/kinsoku when ON; OFF reverts; no crash on weak path
result: [pending]

### 3. Continuous scroll parity
expected: Scroll mode injects same CJK CSS; shim does not break section loads
result: [pending]

### 4. Android materialize + no tofu
expected: bundled-noto faces present; CN sample readable without □ boxes; no font 404
result: [pending]

### 5. Optional WebKit golden
expected: webkit/coverage.png captured when browser installed; no severe ransom-note vs blink
result: [pending]

## Summary

total: 5
passed: 0
issues: 0
pending: 5
skipped: 0
blocked: 0

## Gaps
