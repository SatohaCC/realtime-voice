import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { Card } from "./Card";

it("カードは独立した操作対象を増やさず、内部のボタンを操作できる", () => {
  const onClick = vi.fn();
  render(
    <Card as="article" aria-labelledby="card-title">
      <h2 id="card-title">診療メモ</h2>
      <button type="button" onClick={onClick}>
        詳細を見る
      </button>
    </Card>,
  );
  const card = screen.getByRole("article", { name: "診療メモ" });
  expect(card).not.toHaveAttribute("tabindex");
  expect(screen.getAllByRole("button")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "詳細を見る" }));
  expect(onClick).toHaveBeenCalledOnce();
});

it("リスト項目として使う場合もリストの意味を保持する", () => {
  render(
    <ul>
      <Card as="li">記録内容</Card>
    </ul>,
  );
  expect(screen.getByRole("listitem").parentElement).toBe(screen.getByRole("list"));
});
