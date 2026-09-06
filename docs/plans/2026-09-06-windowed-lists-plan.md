# Bounding rendered cut and caption list elements

2026-09-06. Caption-strip browser 60-minute run two preserved output correctness but failed at 2.045 GiB RSS. Both 1,000-cut and 1,000-caption lists currently exist fully in the DOM. Virtualization is a candidate to reduce repeated rendering cost, not a confirmed leak diagnosis or proven memory fix.

Virtualize lists with at least 200 entries using pinned TanStack Virtual 3.14.10 dynamic height measurement, stable IDs, and overscan. Small lists retain full rendering. Keep complete project data for output/save/restoration/AI. Preserve selected and keyboard-focused entries beyond the visible range and measure actual wrapped heights rather than clipping by estimates. Sources: [API](https://tanstack.com/virtual/latest/docs/api/virtualizer), [dynamic example](https://tanstack.com/virtual/latest/docs/framework/react/examples/dynamic).

Retain scrolling/order/text/timing/restoration and Enter/Space controls. Tab/Shift+Tab move logically; Home/End reach first/last buttons. Focus must survive scrolling. Test unapplied-caption protection, next-review navigation, deletion, edit reordering, undo/redo, and complete project round trips. Expose total count and position via accessibility attributes. Replace the old implementation assumption of all entries always in DOM with actual access to every logical entry. Do not alter source/output timing, rendering quality, cut settings, or source protection.

1. Run type/build/unit checks and package Mac.
2. In both apps, navigate first/middle/last, cross Tab boundaries both directions, use Enter/Space, resize long multiline cues, select/edit/undo/replace projects. Compare all saved text/timing and inspect gaps/overlaps/screens.
3. Regress small-list editing/output/job locks/project races. Update long runners to use actual total-count UI and complete saved projects rather than DOM counts, preserving real interactions and independent output expectations. Keep historical failures.
4. Run both apps' 60-second composition/cancel/retry before the same 60-minute browser repetitions. Keep 2 GiB RSS, each UI p95 200 ms, output correctness, and cancel limits. Stop expanding long conditions at first failure.

Real Korean quality, human editing time, authenticated AI, cache conditions, and OS network blocking remain separate. Do not subtract estimated memory from old failures or disable browser features to pass.
