---
"orchajs": minor
"create-orcha": patch
---

Add first-class local file and URL content inputs. Orcha now accepts
`{ filePath }` and `{ url }` content, infers common MIME types, loads and
encodes bytes only while constructing provider requests, and persists only
local paths and MIME metadata in durable session history.

Native actions now compile project-relative JavaScript and TypeScript imports,
package imports, transitive dependencies, and Node.js built-ins into
self-contained development and production runtimes.
