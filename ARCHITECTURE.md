# Architecture

1. This repository contains only the shared platform layer.

2. No domain-specific application code may live here.

3. Future applications will include the platform under `/platform`.

4. Files under `/platform` are platform-owned; concrete applications must not modify them by hand.

5. Application code in future app repositories is separated under `/app`.

6. Database ownership boundary:

   * `private` = platform/internal data
   * `app` = application domain data
   * `api` = explicitly published application data

7. The platform must not contain knowledge of concrete domain entities.

8. Integration between platform and application happens only through explicit configuration/extension points.
