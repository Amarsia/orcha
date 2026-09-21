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
import { useEffect, useState } from "react";
import { listAgentTests } from "./api";
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
  { kind: GraphKind; label: string },
  "orcha"
>;

const nodeTypes = { orcha: OrchaNode };

export function GraphPanel({ agent, revision }: Props) {
  const [tests, setTests] = useState<AgentTest[]>();

  useEffect(() => {
    setTests(undefined);
    void listAgentTests(agent.key)
      .then(setTests)
      .catch(() => setTests([]));
  }, [agent.key, revision]);

  const graph = createGraph(agent, tests ?? []);

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
        </FlowNodeContent>
      </FlowNodeShell>
    </>
  );
}

function createGraph(
  agent: AgentSource,
  tests: AgentTest[],
): { nodes: OrchaGraphNode[]; edges: Edge[] } {
  const rootId = `agent:${agent.key}`;
  const rootPosition = { x: 390, y: 260 };
  const skillsWidth = Math.max(0, agent.skills.length - 1) * 215;
  const skillsStartX = rootPosition.x + 95 - skillsWidth / 2 - 95;
  const testsStartY =
    rootPosition.y -
    (Math.max(0, tests.length - 1) * 86) / 2;
  const subagentsStartY = 105;
  const actionsStartY =
    subagentsStartY + agent.subagents.length * 86 + 42;
  const rightColumnBottom =
    actionsStartY + Math.max(0, agent.actions.length - 1) * 86 + 68;
  const evaluationsY = Math.max(500, rightColumnBottom + 70);
  const evaluationsWidth =
    Math.max(0, agent.evaluations.length - 1) * 215;
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
      position: { x: 35, y: testsStartY + index * 86 },
      data: { kind: "test" as const, label: test.name },
    })),
    ...agent.subagents.map((subagent, index) => ({
      id: `subagent:${subagent.key}`,
      type: "orcha" as const,
      position: { x: 760, y: subagentsStartY + index * 86 },
      data: { kind: "subagent" as const, label: subagent.name },
    })),
    ...agent.skills.map((skill, index) => ({
      id: `skill:${skill.key}`,
      type: "orcha" as const,
      position: { x: skillsStartX + index * 215, y: 55 },
      data: { kind: "skill" as const, label: skill.name },
    })),
    ...agent.actions.map((action, index) => ({
      id: `action:${action.key}`,
      type: "orcha" as const,
      position: { x: 760, y: actionsStartY + index * 86 },
      data: { kind: "action" as const, label: action.name },
    })),
    ...agent.evaluations.map((evaluation, index) => ({
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
    ...agent.skills.map((skill) => ({
      id: `skill:${skill.key}->${rootId}`,
      source: `skill:${skill.key}`,
      target: rootId,
      targetHandle: "skills",
    })),
    ...agent.actions.map((action) => ({
      id: `${rootId}->action:${action.key}`,
      source: rootId,
      sourceHandle: "actions",
      target: `action:${action.key}`,
    })),
    ...agent.evaluations.map((evaluation) => ({
      id: `${rootId}->evaluation:${evaluation.key}`,
      source: rootId,
      sourceHandle: "evaluations",
      target: `evaluation:${evaluation.key}`,
    })),
  ];
  return { nodes, edges };
}
