"use client";

import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import { Badge, type BadgeProps, Banner, Button, Card } from "@/shared/ui";
import { soapPanelStyles as s } from "./SoapPanel.styles";

export interface SoapEvidenceView {
  streamId: string;
  segmentId: string;
  speakerLabel: string;
  quote: string;
}

export interface SoapItemBadge {
  label: string;
  tone: NonNullable<BadgeProps["tone"]>;
}

export interface SoapPanelItemView {
  itemId: string;
  text: string;
  isChanged?: boolean;
  badges?: readonly SoapItemBadge[];
  evidences: readonly SoapEvidenceView[];
}

export interface SoapPanelSectionView {
  key: "S" | "O" | "A" | "P";
  codeLabel: string;
  title: string;
  emptyLabel: string;
  items: readonly SoapPanelItemView[];
}

export interface SoapPanelProps {
  title: string;
  statusBadgeText: string;
  statusBadgeTone: NonNullable<BadgeProps["tone"]>;
  unappliedBadgeText?: string | null;
  statusBannerText?: string | null;
  statusBannerTone?: "info" | "error";
  copyLabel: string;
  canCopy: boolean;
  onCopy: () => void;
  sections: readonly SoapPanelSectionView[];
  singleEvidencePrefix: string;
  multipleEvidenceLabel: (count: number) => string;
  onSelectEvidence: (streamId: string, segmentId: string) => void;
}

/**
 * 1会話分の固定4欄 (S/O/A/P) を読み取り専用・根拠移動付きで描画するパネル。
 */
export function SoapPanel({
  title,
  statusBadgeText,
  statusBadgeTone,
  unappliedBadgeText,
  statusBannerText,
  statusBannerTone = "info",
  copyLabel,
  canCopy,
  onCopy,
  sections,
  singleEvidencePrefix,
  multipleEvidenceLabel,
  onSelectEvidence,
}: SoapPanelProps) {
  const [expandedEvidenceIds, setExpandedEvidenceIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const toggleExpanded = (itemId: string) => {
    setExpandedEvidenceIds((current) => {
      const next = new Set(current);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  };

  return (
    <div {...stylex.props(s.root)}>
      <div data-pane-header {...stylex.props(s.header)}>
        <div {...stylex.props(s.titleGroup)}>
          <h2 {...stylex.props(s.title)}>{title}</h2>
          <Badge tone={statusBadgeTone}>{statusBadgeText}</Badge>
          {unappliedBadgeText ? <Badge tone="danger">{unappliedBadgeText}</Badge> : null}
        </div>

        <div {...stylex.props(s.headerActions)}>
          <Button variant="outlined" size="sm" onClick={onCopy} disabled={!canCopy}>
            {copyLabel}
          </Button>
        </div>
      </div>

      {statusBannerText ? (
        <Banner
          tone={statusBannerTone === "error" ? "danger" : "info"}
          size="sm"
          role={statusBannerTone === "error" ? "alert" : "status"}
          style={s.statusBanner}
        >
          {statusBannerText}
        </Banner>
      ) : null}

      <section
        aria-label={title}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: 根拠ボタンが無い状態でもキーボードでスクロールできるようにするため
        tabIndex={0}
        data-testid="soap-panel-scroller"
        {...stylex.props(s.scroller)}
      >
        {sections.map((section) => (
          <Card
            key={section.key}
            variant="outlined"
            data-soap-section={section.key}
            style={s.sectionCard}
          >
            <div {...stylex.props(s.sectionHeader)}>
              <div {...stylex.props(s.sectionTitleGroup)}>
                <span aria-hidden="true" {...stylex.props(s.sectionCode)}>
                  {section.codeLabel}
                </span>
                <h3 {...stylex.props(s.sectionTitle)}>{section.title}</h3>
              </div>
              <Badge tone="neutral">{`${section.items.length}`}</Badge>
            </div>

            {section.items.length === 0 ? (
              <p {...stylex.props(s.emptyText)}>{section.emptyLabel}</p>
            ) : (
              <ul aria-label={section.title} {...stylex.props(s.itemList)}>
                {section.items.map((item) => {
                  const isExpanded = expandedEvidenceIds.has(item.itemId);
                  const singleEvidence = item.evidences.length === 1 ? item.evidences[0] : null;

                  return (
                    <Card
                      as="li"
                      key={item.itemId}
                      data-soap-item-id={item.itemId}
                      data-changed={item.isChanged ? "true" : undefined}
                      style={[s.itemRow, item.isChanged && s.itemRowChanged]}
                    >
                      <p {...stylex.props(s.itemText)}>{item.text}</p>

                      <div {...stylex.props(s.itemFooter)}>
                        {item.badges?.map((badge) => (
                          <Badge key={`${item.itemId}:${badge.label}`} tone={badge.tone}>
                            {badge.label}
                          </Badge>
                        ))}

                        {singleEvidence ? (
                          <button
                            type="button"
                            onClick={() =>
                              onSelectEvidence(singleEvidence.streamId, singleEvidence.segmentId)
                            }
                            {...stylex.props(s.evidenceButton)}
                          >
                            {`${singleEvidencePrefix}: ${singleEvidence.speakerLabel}「${singleEvidence.quote}」`}
                          </button>
                        ) : item.evidences.length > 1 ? (
                          <button
                            type="button"
                            aria-expanded={isExpanded}
                            onClick={() => toggleExpanded(item.itemId)}
                            {...stylex.props(s.evidenceButton)}
                          >
                            {multipleEvidenceLabel(item.evidences.length)}
                          </button>
                        ) : null}
                      </div>

                      {item.evidences.length > 1 && isExpanded ? (
                        <ul {...stylex.props(s.evidenceDrawerList)}>
                          {item.evidences.map((ev) => (
                            <li key={`${item.itemId}:${ev.streamId}:${ev.segmentId}`}>
                              <button
                                type="button"
                                onClick={() => onSelectEvidence(ev.streamId, ev.segmentId)}
                                {...stylex.props(s.evidenceButton)}
                              >
                                {`${ev.speakerLabel}「${ev.quote}」`}
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </Card>
                  );
                })}
              </ul>
            )}
          </Card>
        ))}
      </section>
    </div>
  );
}
