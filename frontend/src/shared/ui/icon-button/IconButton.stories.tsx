import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { IconButton } from "./IconButton";

function SampleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5 12h14"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const meta = {
  title: "shared/ui/IconButton",
  component: IconButton,
  tags: ["autodocs"],
  args: {
    "aria-label": "操作",
    variant: "standard",
    size: "md",
    disabled: false,
    children: <SampleIcon />,
  },
} satisfies Meta<typeof IconButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Standard: Story = {};
export const Filled: Story = { args: { variant: "filled" } };
export const Tonal: Story = { args: { variant: "tonal" } };
export const Outlined: Story = { args: { variant: "outlined" } };
export const SmallPressed: Story = { args: { size: "sm", pressed: true } };
export const Disabled: Story = { args: { variant: "filled", disabled: true } };
