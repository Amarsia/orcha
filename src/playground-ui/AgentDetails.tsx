import { Accordion, Panel } from "baseui/accordion";
import { Button, KIND, SIZE } from "baseui/button";
import { Tag } from "baseui/tag";
import { useState } from "react";
import type { AgentSource, SourceItem } from "./types";
import {
  CodeBlock,
  EmptyState,
  MetaRow,
  Muted,
  Page,
  PanelCard,
  SectionHeader,
  SubagentListItem,
  TabButton,
  Tabs,
  Title,
} from "./ui";
import { GraphPanel } from "./GraphPanel";
import { TestsPanel } from "./TestsPanel";

type AgentTab =
  | "instructions"
  | "graph"
  | "actions"
  | "skills"
  | "subagents"
  | "evaluations"
  | "tests";

interface Props {
  agent: AgentSource;
  revision: number;
  onTry: () => void;
}

const tabs: Array<{ id: AgentTab; label: string }> = [
  { id: "instructions", label: "Instructions" },
  { id: "graph", label: "Graph" },
  { id: "actions", label: "Actions" },
  { id: "skills", label: "Skills" },
  { id: "subagents", label: "Subagents" },
  { id: "evaluations", label: "Evaluations" },
  { id: "tests", label: "Tests" },
];

export function AgentDetails({ agent, revision, onTry }: Props) {
  const [tab, setTab] = useState<AgentTab>("instructions");
  return (
    <>
      <SectionHeader>
        <div>
          <Title>{agent.name}</Title>
          <Muted>
            {agent.key} · {agent.provider} / {agent.model}
          </Muted>
        </div>
        <Button size={SIZE.mini} kind={KIND.secondary} onClick={onTry}>
          Try agent
        </Button>
      </SectionHeader>
      <Tabs>
        {tabs.map((item) => (
          <TabButton
            key={item.id}
            $active={item.id === tab}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </TabButton>
        ))}
      </Tabs>
      <Page>
        {tab === "instructions" ? (
          <Instructions agent={agent} />
        ) : tab === "graph" ? (
          <GraphPanel agent={agent} revision={revision} />
        ) : tab === "actions" ? (
          <SourceCollection
            items={agent.actions}
            empty="No actions registered."
            mode="action"
          />
        ) : tab === "skills" ? (
          <SourceCollection
            items={agent.skills}
            empty="No skills registered."
            mode="instructions"
          />
        ) : tab === "subagents" ? (
          <SubagentsPanel agent={agent} />
        ) : tab === "evaluations" ? (
          <SourceCollection
            items={agent.evaluations}
            empty="No evaluations registered."
            mode="evaluation"
          />
        ) : (
          <TestsPanel agent={agent.key} revision={revision} />
        )}
      </Page>
    </>
  );
}

function SubagentsPanel({ agent }: { agent: AgentSource }) {
  if (agent.subagents.length === 0) {
    return <EmptyState>No subagents registered.</EmptyState>;
  }
  return (
    <PanelCard>
      {agent.subagents.map((subagent) => (
        <SubagentListItem key={subagent.key}>
          <Title>{subagent.name}</Title>
          {subagent.description ? (
            <Muted>{subagent.description}</Muted>
          ) : null}
        </SubagentListItem>
      ))}
    </PanelCard>
  );
}

function Instructions({ agent }: { agent: AgentSource }) {
  return (
    <>
      {agent.description ? (
        <Muted style={{ marginBottom: 16 }}>{agent.description}</Muted>
      ) : null}
      <MetaRow style={{ marginBottom: 16 }}>
        <Tag closeable={false}>
          {agent.provider}
        </Tag>
        <Tag closeable={false}>
          {agent.model}
        </Tag>
        {typeof agent.configuration.outputType === "string" ? (
          <Tag closeable={false}>
            {agent.configuration.outputType}
          </Tag>
        ) : null}
      </MetaRow>
      <PanelCard>
        <Accordion>
          <Panel title="Agent configuration">
            <CodeBlock>{agent.rawConfiguration}</CodeBlock>
          </Panel>
        </Accordion>
      </PanelCard>
      <Title style={{ marginBottom: 8 }}>System instructions</Title>
      <CodeBlock>{agent.instructions}</CodeBlock>
    </>
  );
}

function SourceCollection({
  items,
  empty,
  mode,
}: {
  items: SourceItem[];
  empty: string;
  mode: "action" | "instructions" | "evaluation";
}) {
  if (items.length === 0) {
    return <EmptyState>{empty}</EmptyState>;
  }
  return (
    <PanelCard>
      <Accordion accordion={false}>
        {items.map((item) => (
          <Panel
            key={item.key}
            title={
              <div>
                <MetaRow>
                  <Title>{item.name}</Title>
                  {!item.enabled ? (
                    <Tag closeable={false}>disabled</Tag>
                  ) : null}
                </MetaRow>
                {item.description ? <Muted>{item.description}</Muted> : null}
              </div>
            }
          >
            <Title style={{ marginBottom: 8 }}>Configuration</Title>
            <CodeBlock>{item.rawConfiguration}</CodeBlock>
            {mode === "action" && item.source ? (
              <>
                <Title style={{ margin: "18px 0 8px" }}>Source</Title>
                <CodeBlock>{item.source}</CodeBlock>
              </>
            ) : null}
            {mode !== "action" && item.instructions ? (
              <>
                <Title style={{ margin: "18px 0 8px" }}>Instructions</Title>
                <CodeBlock>{item.instructions}</CodeBlock>
              </>
            ) : null}
          </Panel>
        ))}
      </Accordion>
    </PanelCard>
  );
}
