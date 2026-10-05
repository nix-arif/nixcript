// The company this browser tab is working in. The login session (shared by
// every tab) only holds one active company, so each tab keeps its own choice
// in sessionStorage (per tab, survives reloads) and puts the session back to
// it when the user returns to the tab — see components/live-refresh.tsx.
const KEY = "nx_tab_org";

export function getTabOrg(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setTabOrg(id: string) {
  try {
    sessionStorage.setItem(KEY, id);
  } catch {
    /* storage blocked — tab simply follows the session */
  }
}

// Fired on window once this tab has put the session back to its company, for
// widgets that fetch by themselves (not via router.refresh) to fetch again.
export const TAB_ORG_RESTORED = "tab-org-restored";
