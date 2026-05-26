# Meal Combinations Final Checklist

## Cloud Database Checklist

- [ ] Create the new `meal_combinations` collection in the WeChat Cloud Development console before release.
- [ ] Add the recommended compound index for active-list queries: `babyUid + status + updatedAt`.
- [ ] Consider adding the optional compound index for usage-ranked lists or future shortcuts: `babyUid + status + usageCount`.
- [ ] Keep `food_intake_records` as the existing v2 food intake collection. The new planned/actual meal fields do not require a new collection migration.
- [ ] Keep old `food_intake_records` documents compatible when planned fields are missing. Read/edit paths should treat missing planned fields as legacy v2 food records and avoid rescaling from stored completion data.
- [ ] Before production rollout, verify the collection and indexes exist in the WeChat Cloud Development console for the target environment.

## Regression Checklist

- [ ] Run focused meal-combination and v2 food regression tests.
- [ ] Run the broader `node --test tests/*.test.js` suite when the repository test set is runnable.
- [ ] Run `git diff --check` before handoff.
