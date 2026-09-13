# OrchaJS development playground

This directory is a small consumer project used to exercise the local
`orchajs` package while it is being developed.

1. Build the parent package and install this project's dependencies.
2. Set `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`, `OPENAI_API_KEY`, and
   `GOOGLE_API_KEY` in the environment. Set `GOOGLE_CLOUD_PROJECT` and
   `GOOGLE_CLOUD_LOCATION`, and configure Google Application Default
   Credentials, to run the Vertex AI scenario.
3. Run `npm start` from this directory.
4. Inspect the printed result and `.orcha/sessions/<sessionId>.jsonl`.

The playground reads its API keys from the environment, and its generated
`.orcha` runtime directory is ignored by git.

To verify the production boundary without changing application source:

1. Run `npm run build`.
2. Run `npm run start:production`.
3. Inspect `dist/index.js`; the generated Orcha runtime is embedded and
   there is no runtime import of the `orchajs` package.

The invoice scenario exercises three sandboxed local actions and one mocked
client approval action. Its JSONL session shows action requests, validated
results, the client pause/resume boundary, and the final model response.

The support scenario uses OpenAI and a sandboxed subscription-status lookup to
diagnose a realistic account issue. Console output is limited to messages,
tool-call summaries, and final results so each model/action round is easy to
inspect.

The fulfillment scenario uses Google GenAI and a sandboxed order-status lookup
to explain a delayed shipment without inventing carrier events.

The incident scenario uses DeepSeek Reasoner and a sandboxed service-health
lookup to produce an evidence-based initial incident assessment.

The risk scenario uses Vertex AI and a sandboxed transaction-risk lookup to
recommend whether a payment needs manual review.
