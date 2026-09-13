# Instructions for coding agents

* This repository is the canonical upstream for the shared platform layer.

* Do not implement application features here.

* Fix generic/platform bugs in this repository.

* Concrete applications must not patch their local copy of `/platform`.

* If an app needs a new platform capability, the change is made here first; the application then upgrades its platform copy.

## Ownership zones (downstream apps)

```
/platform/** = platform-owned
/app/**      = application-owned
root host glue = host-owned
```

* Business/domain logic must not live in root host glue.
* Platform runtime logic must not be duplicated in root host glue.
* Application source uses TanStack `srcDirectory: "app"`.
* Alias `@/*` points to `/app/*`.
* Generated `app/routeTree.gen.ts` is application-owned generated artifact.
* Change root host glue only when Grok/TanStack/deploy integration requires it.
* Platform upgrades must not routinely change `/app/**`.
* Application features must not routinely change `/platform/**`.
* Root glue changes must be explicit and documented; they are not part of the git subtree.

## Database rules

* Applications must not create domain tables in `private`.
* The platform must not create domain tables in `app`.
* `api` contains only objects the application explicitly publishes (views/functions), never a dump of `app`.
* Downstream apps must not patch platform DB implementation (`platform/src/database/**`).
* DB capability changes are made upstream, then pulled via `git subtree pull`.
* Historical migration files are immutable after release; a new change is a new migration file.
* Import `platform/src/database` only from server-side host code.
* Do not import the runtime barrel from client components if that would pull `getHealthResponse` / database into the browser bundle.
