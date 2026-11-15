import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { SegmentedControl } from "./SegmentedControl";

function ControlledExample() {
  const [mode, setMode] = useState<"dual" | "single">("dual");
  return (
    <SegmentedControl
      aria-label="収音モード"
      value={mode}
      onValueChange={setMode}
      items={[
        { value: "dual", label: "2マイク（話者分離）" },
        { value: "single", label: "1マイク" },
      ]}
    />
  );
}

const meta = {
  title: "shared/ui/SegmentedControl",
  component: SegmentedControl,
  tags: ["autodocs"],
  args: {
    "aria-label": "収音モード",
    defaultValue: "dual",
    items: [
      { value: "dual", label: "2マイク（話者分離）" },
      { value: "single", label: "1マイク" },
    ],
  },
} satisfies Meta<typeof SegmentedControl>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => <ControlledExample />,
};

export const Small: Story = {
  args: {
    size: "sm",
  },
};

export const Disabled: Story = {
  args: {
    disabled: true,
    size: "sm",
  },
};
