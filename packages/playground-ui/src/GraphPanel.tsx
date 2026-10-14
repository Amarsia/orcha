import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Button, KIND, SIZE } from "baseui/button";
import { Spinner } from "baseui/spinner";
import { useEffect, useState } from "react";
import { listAgentTests, runAgentTests } from "./api";
import type { AgentSource, AgentTest } from "./types";
import {
  FlowNodeContent,
  FlowNodeLabel,
  FlowNodeShell,
  FlowNodeType,
  GraphFlowFrame,
} from "./ui";

interface Props {
  agent: AgentSource;
  revision: number;
}

type GraphKind =
  | "agent"
  | "skill"
  | "test"
  | "subagent"
  | "action"
  | "evaluation";
type OrchaGraphNode = Node<
  {
    kind: GraphKind;
    label: string;
    onRun?: () => void;
    running?: boolean;
    testStatus?: "passed" | "failed" | "error";
  },
  "orcha"
>;

const nodeTypes = { orcha: OrchaNode };

export function GraphPanel({ agent, revision }: Props) {
  const [tests, setTests] = useState<AgentTest[]>();
  const [runningTest, setRunningTest] = useState<string>();
  const [testStatuses, setTestStatuses] = useState<
    Record<string, "passed" | "failed" | "error">
  >({});

  useEffect(() => {
    setTests(undefined);
    void listAgentTests(agent.key)
      .then(setTests)
      .catch(() => setTests([]));
  }, [agent.key, revision]);

  const runTest = async (test: string) => {
    setRunningTest(test);
    try {
      const report = await runAgentTests(agent.key, test);
      const result = report.cases.find((item) => item.name === test);
      setTestStatuses((current) => ({
        ...current,
        [test]: result?.status ?? "error",
      }));
    } catch {
      setTestStatuses((current) => ({
        ...current,
        [test]: "error",
      }));
    } finally {
      setRunningTest(undefined);
    }
  };

  const graph = createGraph(
    agent,
    tests ?? [],
    runningTest,
    testStatuses,
    runTest,
  );

  return (
    <GraphFlowFrame>
      <ReactFlow
        key={`${agent.key}-${tests?.length ?? "loading"}`}
        nodes={graph.nodes}
        edges={graph.edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.22, maxZoom: 1 }}
        minZoom={0.35}
        maxZoom={1.5}
        nodesDraggable={false}
        nodesConnectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        zoomOnDoubleClick={false}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{
          type: "smoothstep",
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 14,
            height: 14,
            color: "#9b9b9b",
          },
          style: { stroke: "#b8b8b8", strokeWidth: 1.25 },
        }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={16}
          size={1}
          color="#dedede"
        />
        <Controls showInteractive={false} />
      </ReactFlow>
    </GraphFlowFrame>
  );
}

function OrchaNode({ data }: NodeProps<OrchaGraphNode>) {
  return (
    <>
      {data.kind === "agent" ? (
        <>
          <Handle id="tests" type="target" position={Position.Left} />
          <Handle id="skills" type="target" position={Position.Top} />
          <Handle
            id="subagents"
            type="source"
            position={Position.Right}
            style={{ top: "34%" }}
          />
          <Handle
            id="actions"
            type="source"
            position={Position.Right}
            style={{ top: "68%" }}
          />
          <Handle
            id="evaluations"
            type="source"
            position={Position.Bottom}
          />
        </>
      ) : data.kind === "test" ? (
        <Handle type="source" position={Position.Right} />
      ) : data.kind === "skill" ? (
        <Handle type="source" position={Position.Bottom} />
      ) : data.kind === "subagent" || data.kind === "action" ? (
        <Handle type="target" position={Position.Left} />
      ) : (
        <Handle type="target" position={Position.Top} />
      )}
      <FlowNodeShell $shape={data.kind}>
        <FlowNodeContent>
          <FlowNodeType>
            {data.kind === "test" ? "Test case" : data.kind}
          </FlowNodeType>
          <FlowNodeLabel>{data.label}</FlowNodeLabel>
          {data.kind === "test" && data.onRun ? (
            <Button
              className="nodrag nopan"
              size={SIZE.mini}
              kind={KIND.tertiary}
              disabled={data.running}
              onClick={(event) => {
                event.stopPropagation();
                data.onRun?.();
              }}
              startEnhancer={() =>
                data.running ? (
                  <Spinner $size={10} />
                ) : (
                  <span aria-hidden>▶</span>
                )
              }
              overrides={{
                BaseButton: {
                  style: {
                    marginTop: "6px",
                    paddingLeft: "4px",
                    paddingRight: "4px",
                  },
                },
              }}
            >
              Run
            </Button>
          ) : null}
          {data.kind === "test" && data.testStatus ? (
            <FlowNodeType style={{ marginTop: 3, marginBottom: 0 }}>
              {data.testStatus}
            </FlowNodeType>
          ) : null}
        </FlowNodeContent>
      </FlowNodeShell>
    </>
  );
}

function createGraph(
  agent: AgentSource,
  tests: AgentTest[],
  runningTest: string | undefined,
  testStatuses: Record<string, "passed" | "failed" | "error">,
  onRunTest: (test: string) => void,
): { nodes: OrchaGraphNode[]; edges: Edge[] } {
  const skills = agent.skills.filter((item) => item.enabled);
  const actions = agent.actions.filter((item) => item.enabled);
  const evaluations = agent.evaluations.filter((item) => item.enabled);
  const rootId = `agent:${agent.key}`;
  const rootPosition = { x: 390, y: 260 };
  const skillsWidth = Math.max(0, skills.length - 1) * 215;
  const skillsStartX = rootPosition.x + 95 - skillsWidth / 2 - 95;
  const testsStartY =
    rootPosition.y -
    (Math.max(0, tests.length - 1) * 112) / 2;
  const subagentsStartY = 105;
  const actionsStartY =
    subagentsStartY + agent.subagents.length * 86 + 42;
  const rightColumnBottom =
    actionsStartY + Math.max(0, actions.length - 1) * 86 + 68;
  const evaluationsY = Math.max(500, rightColumnBottom + 70);
  const evaluationsWidth =
    Math.max(0, evaluations.length - 1) * 215;
  const evaluationsStartX =
    rootPosition.x + 95 - evaluationsWidth / 2 - 95;
  const nodes: OrchaGraphNode[] = [
    {
      id: rootId,
      type: "orcha",
      position: rootPosition,
      data: { kind: "agent", label: agent.name },
    },
    ...tests.map((test, index) => ({
      id: `test:${test.name}`,
      type: "orcha" as const,
      position: { x: 35, y: testsStartY + index * 112 },
      data: {
        kind: "test" as const,
        label: test.displayName ?? test.name,
        running: runningTest === test.name,
        testStatus: testStatuses[test.name],
        onRun: () => void onRunTest(test.name),
      },
    })),
    ...agent.subagents.map((subagent, index) => ({
      id: `subagent:${subagent.key}`,
      type: "orcha" as const,
      position: { x: 760, y: subagentsStartY + index * 86 },
      data: { kind: "subagent" as const, label: subagent.name },
    })),
    ...skills.map((skill, index) => ({
      id: `skill:${skill.key}`,
      type: "orcha" as const,
      position: { x: skillsStartX + index * 215, y: 55 },
      data: { kind: "skill" as const, label: skill.name },
    })),
    ...actions.map((action, index) => ({
      id: `action:${action.key}`,
      type: "orcha" as const,
      position: { x: 760, y: actionsStartY + index * 86 },
      data: { kind: "action" as const, label: action.name },
    })),
    ...evaluations.map((evaluation, index) => ({
      id: `evaluation:${evaluation.key}`,
      type: "orcha" as const,
      position: {
        x: evaluationsStartX + index * 215,
        y: evaluationsY,
      },
      data: {
        kind: "evaluation" as const,
        label: evaluation.name,
      },
    })),
  ];
  const edges: Edge[] = [
    ...tests.map((test) => ({
      id: `test:${test.name}->${rootId}`,
      source: `test:${test.name}`,
      target: rootId,
      targetHandle: "tests",
    })),
    ...agent.subagents.map((subagent) => ({
      id: `${rootId}->subagent:${subagent.key}`,
      source: rootId,
      sourceHandle: "subagents",
      target: `subagent:${subagent.key}`,
    })),
    ...skills.map((skill) => ({
      id: `skill:${skill.key}->${rootId}`,
      source: `skill:${skill.key}`,
      target: rootId,
      targetHandle: "skills",
    })),
    ...actions.map((action) => ({
      id: `${rootId}->action:${action.key}`,
      source: rootId,
      sourceHandle: "actions",
      target: `action:${action.key}`,
    })),
    ...evaluations.map((evaluation) => ({
      id: `${rootId}->evaluation:${evaluation.key}`,
      source: rootId,
      sourceHandle: "evaluations",
      target: `evaluation:${evaluation.key}`,
    })),
  ];
  return { nodes, edges };
}
