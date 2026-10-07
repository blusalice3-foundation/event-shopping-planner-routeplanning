// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { MapReimportPlan } from "../../features/map/domain/mapReimport";
import MapReimportConfirmationDialog from "./MapReimportConfirmationDialog";

const plan: MapReimportPlan = {
  eventName: "対象イベント",
  targets: [
    {
      eventDate: "1日目",
      mapTabName: "1日目マップ",
      mapData: {
        maxRow: 1,
        maxCol: 1,
        cells: [],
        mergedCells: [],
        blocks: [
          {
            name: "A",
            startRow: 1,
            startCol: 1,
            endRow: 1,
            endCol: 1,
            numberCells: [],
          },
        ],
      },
      initialAngle: 0,
      maplessKey: "__mapless__:1日目",
      oldMapHallIds: ["map-hall"],
      oldMaplessHallIds: ["mapless-hall"],
      requiresConfirmation: true,
    },
  ],
  impact: {
    targetDayCount: 1,
    visitPointCount: 2,
    mapHallDefinitionCount: 1,
    manualAssignmentCount: 1,
    hallRouteDayCount: 1,
    viewportDayCount: 1,
    rotationDayCount: 1,
    maplessHallDefinitionCount: 3,
    maplessManualAssignmentCount: 2,
    maplessHallRouteDayCount: 1,
  },
  requiresConfirmation: true,
};

describe("MapReimportConfirmationDialog", () => {
  it("explains the protected and reset data and preserves mapless halls by default", () => {
    const onConfirm = vi.fn();
    render(
      <MapReimportConfirmationDialog
        isOpen
        plan={plan}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    expect(
      screen.getByText(/同じマップを使う全日付の所属と巡回情報を再判定/),
    ).toBeInTheDocument();
    expect(screen.getByText("1日目（1日目マップ）")).toBeInTheDocument();
    const preserve = screen.getByRole("checkbox", {
      name: /マップを使わない会場設定を残す/,
    });
    expect(preserve).toBeChecked();

    fireEvent.click(
      screen.getByRole("button", {
        name: "影響範囲を確認する",
      }),
    );
    expect(onConfirm).toHaveBeenCalledWith({
      preserveMaplessHalls: true,
      targetMapKeys: {},
    });
  });

  it("shows the additional impact when mapless halls are not preserved", () => {
    const onConfirm = vi.fn();
    render(
      <MapReimportConfirmationDialog
        isOpen
        plan={plan}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /マップを使わない会場設定を残す/,
      }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "会場3件、手動割り当て2件、巡回設定1日分",
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "影響範囲を確認する",
      }),
    );
    expect(onConfirm).toHaveBeenCalledWith({
      preserveMaplessHalls: false,
      targetMapKeys: {},
    });
  });

  it.each([true, false])(
    "imports directly with mapless hall preservation=%s",
    async (preserve) => {
      const onConfirm = vi.fn();
      render(
        <MapReimportConfirmationDialog
          isOpen
          plan={plan}
          onCancel={vi.fn()}
          onConfirm={onConfirm}
        />,
      );
      if (!preserve)
        fireEvent.click(
          screen.getByRole("checkbox", {
            name: /マップを使わない会場設定を残す/,
          }),
        );
      const direct = screen.getByRole("button", {
        name: "影響を確認せずに取り込む",
      });
      fireEvent.click(direct);
      expect(onConfirm).toHaveBeenCalledOnce();
      expect(onConfirm).toHaveBeenCalledWith({
        preserveMaplessHalls: preserve,
        targetMapKeys: {},
        skipImpactConfirmation: true,
      });
      expect(direct).toBeDisabled();
      expect(
        screen.getByRole("button", { name: "影響範囲を確認する" }),
      ).toBeDisabled();
      await waitFor(() => expect(direct).toBeEnabled());
    },
  );

  it("requires an actual map choice before either import action", async () => {
    const onConfirm = vi.fn();
    render(
      <MapReimportConfirmationDialog
        isOpen
        plan={{
          ...plan,
          targets: plan.targets.map((target) => ({
            ...target,
            targetChoiceRequired: true,
            targetCandidates: ["１日目マップ", "1 日目マップ"],
          })),
        }}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    const direct = screen.getByRole("button", {
      name: "影響を確認せずに取り込む",
    });
    const review = screen.getByRole("button", { name: "影響範囲を確認する" });
    expect(direct).toBeDisabled();
    expect(review).toBeDisabled();
    fireEvent.change(
      screen.getByRole("combobox", { name: "1日目の更新先マップ" }),
      { target: { value: "1 日目マップ" } },
    );
    expect(direct).toBeEnabled();
    expect(review).toBeEnabled();
    fireEvent.click(direct);
    expect(onConfirm).toHaveBeenCalledWith({
      preserveMaplessHalls: true,
      targetMapKeys: { "1日目": "1 日目マップ" },
      skipImpactConfirmation: true,
    });
    await waitFor(() => expect(direct).toBeEnabled());
  });

  it("cancels without confirming", () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <MapReimportConfirmationDialog
        isOpen
        plan={plan}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
