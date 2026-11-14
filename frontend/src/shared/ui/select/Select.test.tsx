import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Select } from "./Select";

const options = [
  { value: "mic-a", label: "Mic A" },
  { value: "mic-b", label: "Mic B" },
  { value: "mic-c", label: "Mic C (無効)", disabled: true },
];

describe("Select", () => {
  const getAnimations = Element.prototype.getAnimations;
  beforeAll(() => {
    Element.prototype.getAnimations = () => [];
  });
  afterAll(() => {
    Element.prototype.getAnimations = getAnimations;
  });

  it("クリックで選択肢を開き、選択変更を通知する", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();

    render(
      <Select label="入力デバイス" options={options} value="mic-a" onValueChange={onValueChange} />,
    );

    const trigger = screen.getByRole("combobox", { name: "入力デバイス" });
    expect(trigger).toHaveTextContent("Mic A");

    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    // jsdom は :popover-open 疑似クラス未対応のため hidden: true でポップオーバー内の option を参照する
    await user.click(screen.getByRole("option", { name: "Mic B", hidden: true }));

    expect(onValueChange).toHaveBeenCalledWith("mic-b");
  });

  it("無効な選択肢はクリックしても変更されない", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();

    render(
      <Select label="入力デバイス" options={options} value="mic-a" onValueChange={onValueChange} />,
    );

    await user.click(screen.getByRole("combobox", { name: "入力デバイス" }));
    await user.click(screen.getByRole("option", { name: "Mic C (無効)", hidden: true }));

    expect(onValueChange).not.toHaveBeenCalled();
  });
});
