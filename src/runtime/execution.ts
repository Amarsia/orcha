import type {
  EvaluationResult,
  Execution,
  ExecutionSnapshot,
  RunResult,
  StreamingRunSnapshot,
} from "../types.js";

export type OutputSnapshotPublisher<TOutput> = (output: TOutput) => void;
export type ExecutionSnapshotPublisher<TOutput> = (
  snapshot: ExecutionSnapshot<TOutput>,
) => void;

export function createExecution<TOutput>(
  sessionId: string,
  execute: (
    publishOutput: OutputSnapshotPublisher<TOutput>,
    publishSnapshot: ExecutionSnapshotPublisher<TOutput>,
  ) => Promise<RunResult<TOutput>>,
  resolveEvaluations?: () => Promise<EvaluationResult[]>,
): Execution<TOutput> {
  let controller: ReadableStreamDefaultController<
    ExecutionSnapshot<TOutput>
  > | undefined;
  let snapshot: ExecutionSnapshot<TOutput> | undefined;
  let snapshotVersion = 0;
  let deliveredVersion = 0;
  let finished = false;

  const flush = (): void => {
    const activeController = controller;
    if (
      !activeController ||
      !snapshot ||
      deliveredVersion === snapshotVersion ||
      (activeController.desiredSize ?? 0) <= 0
    ) {
      return;
    }
    deliveredVersion = snapshotVersion;
    activeController.enqueue(snapshot);
    if (finished) {
      activeController.close();
      if (controller === activeController) {
        controller = undefined;
      }
    }
  };

  const stream = new ReadableStream<ExecutionSnapshot<TOutput>>({
    start(streamController) {
      controller = streamController;
    },
    pull() {
      flush();
    },
    cancel() {
      controller = undefined;
    },
  });

  const publishOutput = (output: TOutput): void => {
    if (
      snapshot?.status === "streaming" &&
      Object.is(snapshot.output, output)
    ) {
      return;
    }
    snapshot = {
      sessionId,
      status: "streaming",
      output,
    } satisfies StreamingRunSnapshot<TOutput>;
    snapshotVersion += 1;
    flush();
  };

  const publishSnapshot = (
    nextSnapshot: ExecutionSnapshot<TOutput>,
  ): void => {
    snapshot = nextSnapshot;
    snapshotVersion += 1;
    flush();
  };

  const result = Promise.resolve()
    .then(() => execute(publishOutput, publishSnapshot))
    .then(
      (runResult) => {
        snapshot = runResult;
        snapshotVersion += 1;
        finished = true;
        flush();
        return runResult;
      },
      (error: unknown) => {
        controller?.error(error);
        controller = undefined;
        throw error;
      },
    );
  const evaluations = result.then(
    () => resolveEvaluations?.() ?? [],
  );

  return {
    stream,
    get snapshot() {
      return snapshot;
    },
    result,
    evaluations,
  };
}
