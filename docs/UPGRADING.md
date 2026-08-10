# Upgrading the platform

* The platform lives in an app repository under `/platform`.
* Files under `/platform/**` must not be edited by hand in a concrete application.
* Upgrade is done via `git subtree pull`.
* Before upgrading, check `compatibility.json`.
* If `breaking=true` or `requiresAppChanges=true`, the agent must not perform a blind upgrade; evaluate migration instructions first.
* A normal platform upgrade must not change application files under `/app/**`.
* After upgrade, verify `platform/VERSION`, build, tests, and `git diff -- app/`.
