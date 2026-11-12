import { useState } from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ShoppingItem } from "../types/item";
import { describe, expect, it } from "vitest";
import FocusMode from "./FocusMode";
import {
  minimalProps,
  singleVisitNoneItemFixture,
  StatefulFocusModeHarness,
} from "./FocusMode.fixtures";

const DistributionFocusHarness = ({
  initialItems,
  enabled = true,
}: {
  initialItems: ShoppingItem[];
  enabled?: boolean;
}) => {
  const [items, setItems] = useState(initialItems);
  return (
    <FocusMode
      {...minimalProps({
        items,
        executeModeItemIds: initialItems.map((item) => item.id),
        purchaseStatusControlMode: "radial",
        postEventDistributionCheckEnabled: enabled,
        onUpdateItem: (updated) =>
          setItems((current) =>
            current.map((item) => (item.id === updated.id ? updated : item)),
          ),
      })}
    />
  );
};

const distributionItem: ShoppingItem = {
  ...singleVisitNoneItemFixture.items[0],
  quantity: 3,
  remarks: "既存メモ",
};

describe("FocusMode purchase status control mode", () => {
  it("passes radial purchase status control mode to focus item cards", async () => {
    render(
      <FocusMode
        {...minimalProps({ ...singleVisitNoneItemFixture })}
        purchaseStatusControlMode="radial"
      />,
    );

    expect(
      await screen.findByRole("button", { name: /Current status/i }),
    ).toHaveAttribute("aria-haspopup", "dialog");
  });

  it("records post-event distribution check answer when a focus item becomes sold out", async () => {
    render(
      <StatefulFocusModeHarness
        initialItems={[singleVisitNoneItemFixture.items[0]]}
        executeModeItemIds={singleVisitNoneItemFixture.executeModeItemIds}
        resumeState={null}
      />,
    );

    const statusButton = await screen.findByRole("button", {
      name: /Current status/i,
    });
    fireEvent.click(statusButton);
    fireEvent.click(
      await screen.findByRole("button", { name: /Current status/i }),
    );

    expect(
      await screen.findByRole("dialog", { name: "事後通販･頒布可否確認" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "記録" }));

    expect(
      screen.getByDisplayValue("通販･頒布確認: 未確認"),
    ).toBeInTheDocument();
  });

  it.each(["save", "defer"] as const)(
    "records a focus limited purchase answer after %s without losing quantities or remarks",
    async (action) => {
      render(<DistributionFocusHarness initialItems={[distributionItem]} />);
      fireEvent.click(
        await screen.findByRole("button", { name: /Current status/i }),
      );
      fireEvent.click(
        screen.getByRole("radio", { name: "LimitedPurchaseに変更" }),
      );
      const quantityDialog = screen.getByRole("dialog", {
        name: "限数購入の数量",
      });
      if (action === "save") {
        fireEvent.change(
          within(quantityDialog).getByRole("textbox", { name: "実購入数" }),
          { target: { value: "1" } },
        );
        fireEvent.click(
          within(quantityDialog).getByRole("button", { name: "保存" }),
        );
      } else {
        fireEvent.click(
          within(quantityDialog).getByRole("button", {
            name: "この商品を後で入力",
          }),
        );
      }

      const checkDialog = await screen.findByRole("dialog", {
        name: "事後通販･頒布可否確認",
      });
      await waitFor(() =>
        expect(checkDialog).toContainElement(
          document.activeElement as HTMLElement,
        ),
      );
      expect(
        screen.queryByRole("dialog", { name: "限数購入の数量" }),
      ).not.toBeInTheDocument();
      fireEvent.change(
        within(checkDialog).getByRole("combobox", { name: "回答内容" }),
        { target: { value: "BOOTH有" } },
      );
      fireEvent.click(
        within(checkDialog).getByRole("button", { name: "記録" }),
      );
      expect(
        screen.getByDisplayValue("既存メモ 通販･頒布確認: BOOTH有"),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: action === "save" ? "1/3" : "-/3" }),
      ).toBeInTheDocument();
    },
  );

  it.each([
    ["single", "SoldOut"],
    ["single", "LimitedPurchase"],
    ["bulk", "SoldOut"],
    ["bulk", "LimitedPurchase"],
  ] as const)(
    "skips focus check and new remarks with the setting off for %s %s",
    async (scope, status) => {
      render(
        <DistributionFocusHarness
          initialItems={[distributionItem]}
          enabled={false}
        />,
      );
      if (scope === "single") {
        fireEvent.click(
          await screen.findByRole("button", { name: /Current status/i }),
        );
        fireEvent.click(screen.getByRole("radio", { name: status + "に変更" }));
      } else {
        fireEvent.click(
          await screen.findByRole("button", {
            name: status === "SoldOut" ? "全売切" : "全限数",
          }),
        );
      }
      if (status === "LimitedPurchase") {
        fireEvent.change(screen.getByRole("textbox", { name: "実購入数" }), {
          target: { value: "1" },
        });
        fireEvent.click(screen.getByRole("button", { name: "保存" }));
        expect(screen.getByRole("button", { name: "1/3" })).toBeInTheDocument();
      }
      expect(
        screen.queryByRole("dialog", { name: "事後通販･頒布可否確認" }),
      ).not.toBeInTheDocument();
      expect(screen.getByDisplayValue("既存メモ")).toBeInTheDocument();
    },
  );

  it.each(["complete", "cancel"] as const)(
    "checks only accepted focus limited purchases when bulk quantities %s",
    async (finish) => {
      render(
        <DistributionFocusHarness
          initialItems={[
            { ...distributionItem, id: "partial", title: "一部購入" },
            { ...distributionItem, id: "remaining", title: "残りの入力" },
          ]}
        />,
      );
      fireEvent.click(await screen.findByRole("button", { name: "全限数" }));
      fireEvent.change(screen.getByRole("textbox", { name: "実購入数" }), {
        target: { value: "1" },
      });
      fireEvent.click(screen.getByRole("button", { name: "保存" }));
      expect(
        screen.queryByRole("dialog", { name: "事後通販･頒布可否確認" }),
      ).not.toBeInTheDocument();
      if (finish === "complete") {
        fireEvent.change(screen.getByRole("textbox", { name: "実購入数" }), {
          target: { value: "3" },
        });
        fireEvent.click(screen.getByRole("button", { name: "保存" }));
        fireEvent.click(
          within(
            screen.getByRole("dialog", { name: "購入済として保存しますか？" }),
          ).getByRole("button", { name: "購入済にする" }),
        );
      } else {
        fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));
      }

      const checkDialog = await screen.findByRole("dialog", {
        name: "事後通販･頒布可否確認",
      });
      expect(within(checkDialog).getByText("一部購入")).toBeInTheDocument();
      expect(
        within(checkDialog).queryByText("残りの入力"),
      ).not.toBeInTheDocument();
      fireEvent.click(
        within(checkDialog).getByRole("button", { name: "キャンセル" }),
      );
      expect(screen.getByRole("button", { name: "1/3" })).toBeInTheDocument();
      expect(screen.getAllByDisplayValue("既存メモ")).toHaveLength(2);
    },
  );
});
