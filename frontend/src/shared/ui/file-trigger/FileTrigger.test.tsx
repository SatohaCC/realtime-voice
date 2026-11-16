import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FileTrigger } from "./FileTrigger";

describe("FileTrigger", () => {
  it("選択されたファイルをコールバックへ通知する", async () => {
    const user = userEvent.setup();
    const onSelectFile = vi.fn();

    render(<FileTrigger label="XMLファイルを選択" accept=".xml" onSelectFile={onSelectFile} />);

    const input = screen.getByLabelText("XMLファイルを選択");
    const file = new File(["<PackIns/>"], "sample.xml", { type: "application/xml" });
    await user.upload(input, file);
    expect(onSelectFile).toHaveBeenCalledWith(file);
  });
});
