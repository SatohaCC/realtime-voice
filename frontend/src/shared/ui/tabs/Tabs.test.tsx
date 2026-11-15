import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Tabs } from "./Tabs";

const items = [
  { value: "one", label: "概要", content: "概要の内容" },
  { value: "two", label: "詳細", content: "詳細の内容" },
  { value: "three", label: "履歴", content: "履歴の内容", disabled: true },
];

describe("Tabs", () => {
  const getAnimations = Element.prototype.getAnimations;
  beforeAll(() => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    );
    // jsdomにないWeb Animations APIを、アニメーションなしのブラウザとして補う。
    Element.prototype.getAnimations = () => [];
  });
  afterAll(() => {
    vi.unstubAllGlobals();
    Element.prototype.getAnimations = getAnimations;
  });
  it("アイコンを読み上げから除き、バッジの意味をタブ名に含める", () => {
    render(
      <Tabs
        aria-label="表示内容"
        items={[
          {
            ...items[0],
            icon: <svg aria-hidden="true" data-testid="tab-icon" />,
            badge: { count: 3, label: "未読3件" },
          },
          items[1],
        ]}
      />,
    );
    expect(screen.getByRole("tab", { name: "概要 未読3件" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("img", { name: "未読3件" })).toHaveTextContent("3");
    expect(screen.getByTestId("tab-icon").parentElement).toHaveAttribute("aria-hidden", "true");
  });
  it("タブとパネルを関連付け、クリックで内容を切り替える", async () => {
    const user = userEvent.setup();
    render(<Tabs aria-label="表示内容" items={items} />);
    const first = screen.getByRole("tab", { name: "概要" });
    expect(first).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: "概要" })).toHaveAttribute(
      "id",
      first.getAttribute("aria-controls"),
    );
    await user.click(screen.getByRole("tab", { name: "詳細" }));
    expect(screen.getByRole("tabpanel", { name: "詳細" })).toHaveTextContent("詳細の内容");
    expect(screen.queryByRole("tabpanel", { name: "概要" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "履歴" }));
    expect(screen.getByRole("tab", { name: "詳細" })).toHaveAttribute("aria-selected", "true");
  });

  it("矢印キーとHome・Endで移動し、無効タブは選択しない", async () => {
    const user = userEvent.setup();
    render(<Tabs aria-label="表示内容" items={items} />);
    await user.tab();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "詳細" })).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "履歴" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "詳細" })).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{Home}");
    expect(screen.getByRole("tab", { name: "概要" })).toHaveAttribute("aria-selected", "true");
  });

  it("手動選択ではEnterを押すまで内容を変えない", async () => {
    const user = userEvent.setup();
    render(<Tabs aria-label="表示内容" items={items} activation="manual" />);
    await user.tab();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "詳細" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "概要" })).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{Enter}");
    expect(screen.getByRole("tab", { name: "詳細" })).toHaveAttribute("aria-selected", "true");
  });

  it("制御された値を保持し、変更要求を親へ通知する", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    const { rerender } = render(
      <Tabs aria-label="表示内容" items={items} value="one" onValueChange={onValueChange} />,
    );
    await user.click(screen.getByRole("tab", { name: "詳細" }));
    expect(onValueChange).toHaveBeenCalledWith("two", expect.anything());
    expect(screen.getByRole("tab", { name: "概要" })).toHaveAttribute("aria-selected", "true");
    rerender(
      <Tabs aria-label="表示内容" items={items} value="two" onValueChange={onValueChange} />,
    );
    expect(screen.getByRole("tabpanel", { name: "詳細" })).toBeVisible();
  });
});
