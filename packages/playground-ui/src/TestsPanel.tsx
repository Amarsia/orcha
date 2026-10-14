import { Accordion, Panel } from "baseui/accordion";
import { Button, KIND, SIZE } from "baseui/button";
import { Spinner } from "baseui/spinner";
import { KIND as TAG_KIND, Tag } from "baseui/tag";
import { useEffect, useState } from "react";
import { listAgentTests, runAgentTests } from "./api";
import type {
  AgentTest,
  TestCaseReport,
  TestReport,
} from "./types";
import {
  CodeBlock,
  EmptyState,
  MetaRow,
  Muted,
  PanelCard,
  Title,
} from "./ui";

interface Props {
  agent: string;
  revision: number;
}

export function TestsPanel({ agent, revision }: Props) {
  const [tests, setTests] = useState<AgentTest[]>([]);
  const [running, setRunning] = useState<string>();
  const [reports, setReports] = useState<Record<string, TestCaseReport>>({});
  const [error, setError] = useState<string>();

  useEffect(() => {
    setError(undefined);
    void listAgentTests(agent)
      .then(setTests)
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : String(reason)),
      );
  }, [agent, revision]);

  const run = async (test?: string) => {
    const key = test ?? "*";
    setRunning(key);
    setError(undefined);
    try {
      const report = await runAgentTests(agent, test);
      setReports((current) => mergeReports(current, report));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setRunning(undefined);
    }
  };

  if (error) {
    return <EmptyState>{error}</EmptyState>;
  }
  if (tests.length === 0) {
    return <EmptyState>No tests registered for this agent.</EmptyState>;
  }

  return (
    <>
      <MetaRow style={{ marginBottom: 16 }}>
        <Button
          size={SIZE.compact}
          onClick={() => void run()}
          disabled={running !== undefined}
          startEnhancer={running === "*" ? () => <Spinner $size={14} /> : undefined}
        >
          Run all tests
        </Button>
        <Muted>Tests call the configured model and may consume tokens.</Muted>
      </MetaRow>
      <PanelCard>
        <Accordion accordion={false}>
          {tests.map((test) => {
            const report = reports[test.name];
            return (
              <Panel
                key={test.name}
                title={
                  <MetaRow>
                    <Title>{test.displayName ?? test.name}</Title>
                    {report ? (
                      <Tag
                        closeable={false}
                        kind={
                          report.status === "passed"
                            ? TAG_KIND.positive
                            : TAG_KIND.negative
                        }
                      >
                        {report.status}
                      </Tag>
                    ) : null}
                  </MetaRow>
                }
              >
                {test.description ? <Muted>{test.description}</Muted> : null}
                <MetaRow style={{ margin: "12px 0" }}>
                  <Button
                    size={SIZE.mini}
                    kind={KIND.secondary}
                    disabled={running !== undefined}
                    onClick={() => void run(test.name)}
                    startEnhancer={
                      running === test.name
                        ? () => <Spinner $size={12} />
                        : undefined
                    }
                  >
                    Run test
                  </Button>
                  {report ? (
                    <Muted>
                      {report.durationMs}ms
                      {report.sessionPath ? ` · ${report.sessionPath}` : ""}
                    </Muted>
                  ) : null}
                </MetaRow>
                {(report?.warnings ?? test.warnings)?.map((warning) => (
                  <Muted key={`${warning.code}:${warning.actions.join(",")}`}>
                    Warning: {warning.message}
                  </Muted>
                ))}
                {report?.assertions
                  .filter((assertion) => !assertion.passed)
                  .map((assertion) => (
                    <Muted key={assertion.path}>{assertion.message}</Muted>
                  ))}
                <CodeBlock>{test.rawConfiguration}</CodeBlock>
              </Panel>
            );
          })}
        </Accordion>
      </PanelCard>
    </>
  );
}

function mergeReports(
  current: Record<string, TestCaseReport>,
  report: TestReport,
): Record<string, TestCaseReport> {
  const next = { ...current };
  for (const item of report.cases) {
    next[item.name] = item;
  }
  return next;
}
