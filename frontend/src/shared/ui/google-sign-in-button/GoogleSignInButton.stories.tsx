import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { fn } from "storybook/test";
import { GoogleSignInButton } from "./GoogleSignInButton";

const meta = {
  title: "Shared/UI/GoogleSignInButton",
  component: GoogleSignInButton,
  args: { label: "Google でログイン", logoSrc: "/identity/google-g.png", onClick: fn() },
} satisfies Meta<typeof GoogleSignInButton>;

export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const Pending: Story = { args: { label: "Google へ移動中...", disabled: true } };
