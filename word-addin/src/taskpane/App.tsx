import React, { useState } from "react";
import {
  Button,
  Spinner,
  Tab,
  TabList,
  SelectTabData,
  Text,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { useAuth } from "./auth/useAuth";
import { LoginPage } from "./auth/LoginPage";
import { ChatPanel } from "./components/ChatPanel";
import { DocumentActions } from "./components/DocumentActions";
import { WorkflowPicker } from "./components/WorkflowPicker";
import { ProjectPicker } from "./components/ProjectPicker";

type TabValue = "chat" | "actions" | "workflows" | "projects";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    overflow: "hidden",
    backgroundColor: tokens.colorNeutralBackground1,
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    backgroundColor: tokens.colorBrandBackground,
    flexShrink: 0,
  },
  headerTitle: {
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase500,
    color: tokens.colorNeutralForegroundOnBrand,
  },
  signOutBtn: {
    color: tokens.colorNeutralForegroundOnBrand,
    minWidth: "unset",
  },
  tabList: {
    flexShrink: 0,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    paddingLeft: tokens.spacingHorizontalS,
  },
  tabContent: {
    flex: "1 1 0",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
  },
  loadingState: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100vh",
  },
});

export default function App(): React.ReactElement {
  const styles = useStyles();
  const { token, loading, logout } = useAuth();
  const [selectedTab, setSelectedTab] = useState<TabValue>("chat");

  const handleTabSelect = (_e: unknown, data: SelectTabData): void => {
    setSelectedTab(data.value as TabValue);
  };

  // Show a minimal spinner while the token is being read from storage
  if (loading) {
    return (
      <div className={styles.loadingState}>
        <Spinner label="Loading…" />
      </div>
    );
  }

  if (!token) {
    return <LoginPage />;
  }

  const renderTab = (): React.ReactElement => {
    switch (selectedTab) {
      case "chat":
        return <ChatPanel />;
      case "actions":
        return <DocumentActions />;
      case "workflows":
        return <WorkflowPicker />;
      case "projects":
        return <ProjectPicker />;
    }
  };

  return (
    <div className={styles.root}>
      {/* Header */}
      <div className={styles.header}>
        <Text className={styles.headerTitle}>Mike</Text>
        <Button
          appearance="subtle"
          size="small"
          className={styles.signOutBtn}
          onClick={() => void logout()}
        >
          Sign out
        </Button>
      </div>

      {/* Tab bar */}
      <TabList
        className={styles.tabList}
        selectedValue={selectedTab}
        onTabSelect={handleTabSelect}
        size="small"
      >
        <Tab value="chat">Chat</Tab>
        <Tab value="actions">Actions</Tab>
        <Tab value="workflows">Workflows</Tab>
        <Tab value="projects">Projects</Tab>
      </TabList>

      {/* Active tab content */}
      <div className={styles.tabContent}>{renderTab()}</div>
    </div>
  );
}
