# Branch protection for `master` (ST-3 / BRI-98)

CI (`.github/workflows/ci.yml`) publishes two status checks on every PR:

- **`lint-typecheck-test`**
- **`migrate`**

For a failing check to actually *block* merge into `master` (and a green one to
allow it), `master` needs a branch protection rule (or ruleset) that marks those
two checks **required**.

## ⚠️ Why this wasn't applied automatically

This repo is **private** under a **free (User) plan**. Both the classic Branch
Protection API and the Rulesets API return:

> `403 — Upgrade to GitHub Pro or make this repository public to enable this feature.`

So protection cannot be enabled from CI/CLI today. Enable it after **either**:

- upgrading the account to **GitHub Pro / Team**, or
- making the repo **public**.

Until then, CI still runs and reports pass/fail on every PR — it just isn't
enforced as a merge gate yet.

## Option A — GitHub UI (Rulesets, recommended)

**Settings → Rules → Rulesets → New branch ruleset**

- **Name:** `Protect master — CI required`
- **Enforcement status:** `Active`
- **Target branches:** Include `master` (default branch)
- **Rules — enable:**
  - **Require a pull request before merging** — Required approvals: `0`
    (keep at 0 so a green PR is immediately mergeable; raise later if you want
    human review too).
  - **Require status checks to pass** — **Require branches to be up to date
    before merging** ✅, and add these two checks:
    - `lint-typecheck-test`
    - `migrate`
  - **Block force pushes** ✅
  - **Restrict deletions** ✅
- **Bypass list:** empty (so the gate applies to admins too).

## Option A′ — GitHub UI (classic Branch protection)

**Settings → Branches → Add branch protection rule**

- **Branch name pattern:** `master`
- ✅ Require a pull request before merging (Required approvals: `0`)
- ✅ Require status checks to pass before merging
  - ✅ Require branches to be up to date before merging
  - Required checks: `lint-typecheck-test`, `migrate`
- ✅ Include administrators
- Leave "Restrict who can push" unset.

## Option B — Script it once the plan allows

Both payloads are ready to apply verbatim.

### Ruleset (works on private repos once on Pro/Team)

```bash
gh api -X POST repos/BridgeXconnect/foliovoyage/rulesets --input - <<'JSON'
{
  "name": "Protect master — CI required",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["refs/heads/master"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": false,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false
      }
    },
    { "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": true,
        "do_not_enforce_on_create": false,
        "required_status_checks": [
          { "context": "lint-typecheck-test" },
          { "context": "migrate" }
        ]
      }
    }
  ],
  "bypass_actors": []
}
JSON
```

### Classic branch protection (needs a public repo or Pro/Team)

```bash
gh api -X PUT repos/BridgeXconnect/foliovoyage/branches/master/protection --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "checks": [
      { "context": "lint-typecheck-test" },
      { "context": "migrate" }
    ]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": null,
  "restrictions": null
}
JSON
```

> The status-check **context names must match the job names** in
> `ci.yml` exactly (`lint-typecheck-test`, `migrate`). If you rename a job,
> update the required checks here too.
