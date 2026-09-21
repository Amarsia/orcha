import { styled } from "baseui";

export const AppFrame = styled("div", ({ $theme }) => ({
  position: "fixed",
  inset: 0,
  display: "flex",
  flexDirection: "column",
  color: $theme.colors.contentPrimary,
  backgroundColor: $theme.colors.backgroundPrimary,
  fontFamily: $theme.typography.font100.fontFamily,
  fontSize: "13px",
}));

export const Header = styled("header", ({ $theme }) => ({
  height: "44px",
  flexShrink: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  paddingLeft: $theme.sizing.scale500,
  paddingRight: $theme.sizing.scale500,
  borderBottom: `1px solid ${$theme.colors.borderOpaque}`,
  backgroundColor: $theme.colors.backgroundPrimary,
}));

export const Brand = styled("div", ({ $theme }) => ({
  display: "flex",
  alignItems: "center",
  gap: $theme.sizing.scale300,
}));

export const BrandIcon = styled("img", {
  width: "24px",
  height: "24px",
  flexShrink: 0,
});

export const Columns = styled("div", {
  minHeight: 0,
  flex: 1,
  display: "grid",
  gridTemplateColumns: "216px minmax(520px, 1fr) 280px",
});

export const Sidebar = styled<"aside", { $right?: boolean }>(
  "aside",
  ({ $theme, $right }) => ({
    minWidth: 0,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    backgroundColor: $theme.colors.backgroundSecondary,
    ...($right
      ? { borderLeft: `1px solid ${$theme.colors.borderOpaque}` }
      : { borderRight: `1px solid ${$theme.colors.borderOpaque}` }),
  }),
);

export const Main = styled("main", ({ $theme }) => ({
  minWidth: 0,
  overflow: "auto",
  backgroundColor: $theme.colors.backgroundPrimary,
}));

export const SectionHeader = styled("div", ({ $theme }) => ({
  minHeight: "42px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: $theme.sizing.scale400,
  paddingLeft: $theme.sizing.scale400,
  paddingRight: $theme.sizing.scale400,
  borderBottom: `1px solid ${$theme.colors.borderOpaque}`,
}));

export const ScrollArea = styled("div", {
  minHeight: 0,
  overflowY: "auto",
  flex: 1,
});

export const NavItem = styled<"button", { $active?: boolean }>(
  "button",
  ({ $theme, $active }) => ({
    width: "100%",
    border: 0,
    textAlign: "left",
    cursor: "pointer",
    padding: `${$theme.sizing.scale400} ${$theme.sizing.scale400}`,
    color: $theme.colors.contentPrimary,
    backgroundColor: $active
      ? $theme.colors.backgroundTertiary
      : "transparent",
    borderLeft: `2px solid ${
      $active ? $theme.colors.contentPrimary : "transparent"
    }`,
    ":hover": {
      backgroundColor: $theme.colors.backgroundTertiary,
    },
  }),
);

export const Title = styled("div", ({ $theme }) => ({
  ...$theme.typography.LabelSmall,
  color: $theme.colors.contentPrimary,
  lineHeight: "18px",
}));

export const Muted = styled("div", ({ $theme }) => ({
  ...$theme.typography.LabelXSmall,
  color: $theme.colors.contentSecondary,
  fontSize: "11px",
  lineHeight: "16px",
}));

export const Page = styled("div", ({ $theme }) => ({
  maxWidth: "920px",
  marginLeft: "auto",
  marginRight: "auto",
  padding: $theme.sizing.scale600,
}));

export const Tabs = styled("div", ({ $theme }) => ({
  display: "flex",
  gap: $theme.sizing.scale600,
  minHeight: "40px",
  alignItems: "end",
  overflowX: "auto",
  paddingLeft: $theme.sizing.scale600,
  paddingRight: $theme.sizing.scale600,
  borderBottom: `1px solid ${$theme.colors.borderOpaque}`,
}));

export const TabButton = styled<"button", { $active?: boolean }>(
  "button",
  ({ $theme, $active }) => ({
    borderTop: 0,
    borderLeft: 0,
    borderRight: 0,
    borderBottom: `2px solid ${
      $active ? $theme.colors.contentPrimary : "transparent"
    }`,
    backgroundColor: "transparent",
    color: $active
      ? $theme.colors.contentPrimary
      : $theme.colors.contentSecondary,
    cursor: "pointer",
    whiteSpace: "nowrap",
    padding: `${$theme.sizing.scale300} 0 ${$theme.sizing.scale400}`,
    ...$theme.typography.LabelXSmall,
  }),
);

export const PanelCard = styled("section", ({ $theme }) => ({
  border: `1px solid ${$theme.colors.borderOpaque}`,
  borderRadius: $theme.borders.radius200,
  backgroundColor: $theme.colors.backgroundPrimary,
  overflow: "hidden",
  marginBottom: $theme.sizing.scale400,
}));

export const CodeBlock = styled("pre", ({ $theme }) => ({
  margin: 0,
  padding: $theme.sizing.scale500,
  overflowX: "auto",
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
  color: $theme.colors.contentPrimary,
  backgroundColor: $theme.colors.backgroundSecondary,
  fontFamily:
    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  fontSize: "11.5px",
  lineHeight: 1.55,
}));

export const MetaRow = styled("div", ({ $theme }) => ({
  display: "flex",
  flexWrap: "wrap",
  gap: $theme.sizing.scale200,
  alignItems: "center",
}));

export const Disclosure = styled("div", ({ $theme }) => ({
  borderBottom: `1px solid ${$theme.colors.borderOpaque}`,
  ":last-child": {
    borderBottom: 0,
  },
}));

export const DisclosureButton = styled("button", ({ $theme }) => ({
  width: "100%",
  minHeight: "36px",
  display: "flex",
  alignItems: "center",
  gap: $theme.sizing.scale300,
  padding: `${$theme.sizing.scale300} ${$theme.sizing.scale200}`,
  border: 0,
  color: $theme.colors.contentPrimary,
  backgroundColor: "transparent",
  cursor: "pointer",
  textAlign: "left",
  fontSize: "12px",
  ":hover": {
    color: $theme.colors.contentSecondary,
  },
}));

export const DisclosureDetails = styled("div", ({ $theme }) => ({
  padding: `0 ${$theme.sizing.scale200} ${$theme.sizing.scale500} ${$theme.sizing.scale600}`,
}));

export const DisclosureChevron = styled<"span", { $open?: boolean }>(
  "span",
  ({ $theme, $open }) => ({
    width: "12px",
    flexShrink: 0,
    color: $theme.colors.contentSecondary,
    transform: $open ? "rotate(90deg)" : "none",
    transitionProperty: "transform",
    transitionDuration: "120ms",
    fontSize: "15px",
    lineHeight: "12px",
  }),
);

export const RoleLabel = styled("div", ({ $theme }) => ({
  marginBottom: $theme.sizing.scale200,
  color: $theme.colors.contentSecondary,
  ...$theme.typography.LabelXSmall,
  fontSize: "11px",
}));

export const MarkdownRoot = styled("div", {
  whiteSpace: "normal",
});

export const MarkdownParagraph = styled("p", ({ $theme }) => ({
  marginTop: 0,
  marginBottom: $theme.sizing.scale400,
  lineHeight: 1.6,
  ":last-child": {
    marginBottom: 0,
  },
}));

export const MarkdownHeading = styled("h3", ({ $theme }) => ({
  marginTop: $theme.sizing.scale500,
  marginBottom: $theme.sizing.scale300,
  color: $theme.colors.contentPrimary,
  ...$theme.typography.HeadingXSmall,
  fontSize: "14px",
  lineHeight: "20px",
}));

export const MarkdownList = styled("ul", ({ $theme }) => ({
  marginTop: $theme.sizing.scale200,
  marginBottom: $theme.sizing.scale400,
  paddingLeft: $theme.sizing.scale700,
  lineHeight: 1.6,
}));

export const MarkdownOrderedList = styled("ol", ({ $theme }) => ({
  marginTop: $theme.sizing.scale200,
  marginBottom: $theme.sizing.scale400,
  paddingLeft: $theme.sizing.scale700,
  lineHeight: 1.6,
}));

export const MarkdownListItem = styled("li", ({ $theme }) => ({
  marginBottom: $theme.sizing.scale200,
}));

export const MarkdownInlineCode = styled("code", ({ $theme }) => ({
  padding: "1px 4px",
  borderRadius: $theme.borders.radius100,
  color: $theme.colors.contentPrimary,
  backgroundColor: $theme.colors.backgroundTertiary,
  fontFamily:
    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  fontSize: "0.92em",
}));

export const MarkdownQuote = styled("blockquote", ({ $theme }) => ({
  margin: `${$theme.sizing.scale400} 0`,
  paddingLeft: $theme.sizing.scale500,
  borderLeft: `2px solid ${$theme.colors.borderOpaque}`,
  color: $theme.colors.contentSecondary,
}));

export const MarkdownLink = styled("a", ({ $theme }) => ({
  color: $theme.colors.linkText,
  textDecoration: "none",
  ":hover": {
    textDecoration: "underline",
  },
}));

export const SubagentListItem = styled("div", ({ $theme }) => ({
    padding: `${$theme.sizing.scale400} ${$theme.sizing.scale500}`,
    borderBottom: `1px solid ${$theme.colors.borderOpaque}`,
    color: $theme.colors.contentPrimary,
    ...$theme.typography.LabelSmall,
    ":last-child": {
      borderBottom: 0,
    },
  }));

export const GraphFlowFrame = styled("div", ({ $theme }) => ({
  width: "100%",
  height: "500px",
  border: `1px solid ${$theme.colors.borderOpaque}`,
  borderRadius: $theme.borders.radius200,
  overflow: "hidden",
  backgroundColor: $theme.colors.backgroundPrimary,
}));

export const FlowNodeShell = styled<
  "div",
  {
    $shape:
      | "agent"
      | "skill"
      | "test"
      | "subagent"
      | "action"
      | "evaluation";
  }
>("div", ({ $theme, $shape }) => ({
  width: "190px",
  minHeight: "68px",
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  justifyContent: "flex-start",
  boxSizing: "border-box",
  padding: $theme.sizing.scale400,
  borderWidth: $shape === "agent" ? "1.5px" : "1px",
  borderStyle:
    $shape === "subagent"
      ? "dotted"
      : $shape === "skill"
        ? "dashed"
        : "solid",
  borderColor:
    $shape === "agent" || $shape === "subagent"
      ? $theme.colors.contentPrimary
      : $theme.colors.borderOpaque,
  borderRadius:
    $shape === "agent" || $shape === "subagent"
      ? $theme.borders.radius300
      : $theme.borders.radius200,
  backgroundColor: $theme.colors.backgroundPrimary,
  color: $theme.colors.contentPrimary,
  textAlign: "left",
  fontSize: "11.5px",
  lineHeight: 1.3,
  overflow: "hidden",
}));

export const FlowNodeContent = styled("div", {
  width: "100%",
  minWidth: 0,
});

export const FlowNodeType = styled("div", ({ $theme }) => ({
  marginBottom: "3px",
  color: $theme.colors.contentSecondary,
  fontSize: "9px",
  fontWeight: 500,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
}));

export const FlowNodeLabel = styled("div", ({ $theme }) => ({
  width: "100%",
  color: $theme.colors.contentPrimary,
  ...$theme.typography.LabelXSmall,
  fontSize: "11.5px",
  lineHeight: 1.3,
  overflow: "visible",
  overflowWrap: "anywhere",
}));

export const EmptyState = styled("div", ({ $theme }) => ({
  padding: $theme.sizing.scale700,
  color: $theme.colors.contentSecondary,
  textAlign: "center",
  ...$theme.typography.ParagraphSmall,
}));

export const Transcript = styled("div", ({ $theme }) => ({
  maxWidth: "760px",
  margin: "0 auto",
  padding: `${$theme.sizing.scale600} ${$theme.sizing.scale600} ${$theme.sizing.scale900}`,
}));

export const Message = styled<"div", { $role?: "user" | "assistant" }>(
  "div",
  ({ $theme, $role }) => ({
    marginBottom: $theme.sizing.scale500,
    padding: $theme.sizing.scale500,
    border: 0,
    borderRadius: $theme.borders.radius200,
    backgroundColor:
      $role === "user"
        ? $theme.colors.backgroundSecondary
        : $theme.colors.backgroundPrimary,
    whiteSpace: "pre-wrap",
    lineHeight: 1.55,
    fontSize: "13px",
  }),
);

export const WorkspaceTabs = styled("div", ({ $theme }) => ({
  height: "40px",
  display: "flex",
  alignItems: "end",
  overflowX: "auto",
  borderBottom: `1px solid ${$theme.colors.borderOpaque}`,
  backgroundColor: $theme.colors.backgroundSecondary,
}));

export const WorkspaceTab = styled<"button", { $active?: boolean }>(
  "button",
  ({ $theme, $active }) => ({
    height: "33px",
    minWidth: "132px",
    maxWidth: "220px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: $theme.sizing.scale300,
    paddingLeft: $theme.sizing.scale500,
    paddingRight: $theme.sizing.scale400,
    borderTop: `1px solid ${
      $active ? $theme.colors.borderOpaque : "transparent"
    }`,
    borderLeft: `1px solid ${
      $active ? $theme.colors.borderOpaque : "transparent"
    }`,
    borderRight: `1px solid ${
      $active ? $theme.colors.borderOpaque : "transparent"
    }`,
    borderBottom: 0,
    color: $theme.colors.contentPrimary,
    backgroundColor: $active
      ? $theme.colors.backgroundPrimary
      : "transparent",
    cursor: "pointer",
    fontSize: "12px",
    whiteSpace: "nowrap",
  }),
);
