# OrchaJS development playground

This directory is a small consumer project used to exercise the local
`orchajs` package while it is being developed.

1. Build the parent package and install this project's dependencies.
2. Set `ANTHROPIC_API_KEY` in the environment.
3. Run `npm start` from this directory.
4. Inspect the printed result and `.orcha/sessions/<sessionId>.jsonl`.

The playground reads its API key from the environment, and its generated
`.orcha` runtime directory is ignored by git.

To verify the production boundary without changing application source:

1. Run `npm run build`.
2. Run `npm run start:production`.
3. Inspect `dist/index.js`; the generated Orcha runtime is embedded and
   there is no runtime import of the `orchajs` package.

The invoice scenario exercises three sandboxed local actions and one mocked
client approval action. Its JSONL session shows action requests, validated
results, the client pause/resume boundary, and the final model response.
