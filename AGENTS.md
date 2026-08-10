# Instructions for coding agents

* This repository is the canonical upstream for the shared platform layer.

* Do not implement application features here.

* Fix generic/platform bugs in this repository.

* Concrete applications must not patch their local copy of `/platform`.

* If an app needs a new platform capability, the change is made here first; the application then upgrades its platform copy.
