import { beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { ExceptionNotifications } from "./ExceptionNotifications";

const state = vi.hoisted(() => ({ spaceId: "space-a", filters: {} as unknown }));
vi.mock("@/components/shell/SpaceProvider", () => ({ useActiveSpace: () => ({ id: state.spaceId }) }));
vi.mock("@/lib/queries/useTable", () => ({
  useTableList: (_table: string, options: unknown) => { state.filters = options; return { refetch: vi.fn() }; },
  useTableRow: vi.fn(),
}));
vi.mock("@/lib/queries/screens", () => ({ useRowsByIds: () => ({ data: [] }) }));
vi.mock("@/lib/realtime/useRealtimeInvalidation", () => ({ useRealtimeInvalidation: vi.fn() }));
vi.mock("@/app/(app)/exceptions/ExceptionsScreen", () => ({ useExceptionData: () => ({
  exceptions: [{ id: "foreign", space_id: "space-a", status: "open", action_id: "action", created_at: "2026-10-18", evidence: {} }],
  actionById: new Map(), unitById: new Map(),
}) }));
vi.mock("@/app/(app)/exceptions/ExceptionCard", () => ({ exceptionTitle: () => "Page review recommendation" }));
vi.mock("@/app/(app)/exceptions/ExceptionDialog", () => ({ ExceptionDialog: () => null }));
vi.mock("@/app/(app)/_components/ActionSummary", () => ({ UNIT_ACTION_TYPES: new Set() }));
vi.mock("@/components/actions/useServerAction", () => ({ useServerAction: () => ({ isPending: false }) }));
vi.mock("@/lib/server-actions/knowledge", () => ({ answerException: vi.fn() }));

beforeEach(() => { state.spaceId = "space-a"; });

it("scopes approval reads to the visible space even if a caller supplies another space", async () => {
  const { useExceptions } = await import("@/lib/queries");
  useExceptions({ filters: { status: "open", space_id: "space-b" }, limit: 50 });
  expect(state.filters).toMatchObject({ filters: { status: "open", space_id: "space-a" }, limit: 50 });
});

it("shows the owning space's approval and hides stale approval data after switching spaces", () => {
  expect(renderToStaticMarkup(createElement(ExceptionNotifications))).toContain("Page review recommendation");
  state.spaceId = "space-b";
  expect(renderToStaticMarkup(createElement(ExceptionNotifications))).not.toContain("Pending approvals");
});
