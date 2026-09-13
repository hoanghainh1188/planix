import { useMemo, useRef, useState, type JSX } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  createExpandedStore,
  defaultExpanded,
  expandToDepth,
  flattenVisible,
  searchVisible,
  toggle,
} from '../../model/tree-model.js';
import type { WbsRow } from '../../data/types.js';
import './wbs-tree.css';

const ROW_HEIGHT = 28;

/** §10.4 — danh sách cột, đúng thứ tự spec liệt kê. */
const COLUMNS = ['No.', 'Task', 'PIC', 'Status', '%', 'MD', 'Plan Start', 'Plan End', 'Float'];

export interface WbsTreeProps {
  readonly projectId: string;
  readonly rows: readonly WbsRow[];
  readonly onSelect?: (uid: string) => void;
  readonly selectedUid?: string | null;
}

export function WbsTree({ projectId, rows, onSelect, selectedUid }: WbsTreeProps): JSX.Element {
  const store = useMemo(
    () => createExpandedStore(typeof window === 'undefined' ? null : window.localStorage),
    [],
  );

  // §10.4 "nhớ trạng thái giữa các lần vào": ưu tiên thứ đã lưu, không có thì mở tới cấp 3.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => store.load(projectId) ?? defaultExpanded(rows),
  );
  const [query, setQuery] = useState('');
  const [depthPreset, setDepthPreset] = useState(3);

  const visible = useMemo(
    () => (query.trim() === '' ? flattenVisible(rows, expanded) : searchVisible(rows, query)),
    [rows, expanded, query],
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  function applyExpanded(next: Set<string>): void {
    setExpanded(next);
    store.save(projectId, next);
  }

  function setPreset(depth: number): void {
    setDepthPreset(depth);
    applyExpanded(expandToDepth(rows, depth));
  }

  return (
    <section className="wbs" aria-label="WBS tree">
      <div className="wbs__toolbar">
        <input
          className="wbs__search"
          type="search"
          value={query}
          placeholder="Search tasks or WBS code…"
          aria-label="Search tasks"
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="wbs__depth" role="group" aria-label="Expand to level">
          {[1, 2, 3, 4].map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={depthPreset === d}
              onClick={() => setPreset(d)}
            >
              L{d}
            </button>
          ))}
        </div>
        <span className="wbs__count">
          {visible.length.toLocaleString('en-US')} / {rows.length.toLocaleString('en-US')} rows
        </span>
      </div>

      <div className="wbs__scroll" ref={scrollRef}>
        <div className="wbs__grid wbs__head" role="row">
          {COLUMNS.map((c) => (
            <span key={c} role="columnheader">
              {c}
            </span>
          ))}
        </div>

        {visible.length === 0 ? (
          <p className="wbs__empty">No tasks match “{query}”.</p>
        ) : (
          <div className="wbs__body" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => {
              const entry = visible[item.index];
              if (entry === undefined) return null;
              const { node, hasChildren, isExpanded } = entry;
              return (
                <div
                  key={node.uid}
                  className="wbs__grid wbs__row"
                  role="row"
                  data-critical={node.isCritical}
                  data-kind={node.kind}
                  data-selected={selectedUid === node.uid}
                  style={{ transform: `translateY(${item.start}px)` }}
                  onClick={() => onSelect?.(node.uid)}
                >
                  <span className="wbs__cell wbs__cell--num">{node.wbsCode}</span>

                  <span
                    className="wbs__cell wbs__name"
                    style={{ paddingLeft: `calc(${node.depth - 1} * 14px + 8px)` }}
                  >
                    <button
                      type="button"
                      className="wbs__twisty"
                      data-open={isExpanded}
                      aria-label={isExpanded ? 'Collapse' : 'Expand'}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (hasChildren) applyExpanded(toggle(expanded, node.uid));
                      }}
                    >
                      {hasChildren ? '▶' : ''}
                    </button>
                    <span className="wbs__label">{node.name}</span>
                    {node.kind === 'summary' && node.childSequencing !== null ? (
                      <span className="wbs__seq" data-mode={node.childSequencing}>
                        {node.childSequencing === 'sequential' ? 'SEQ' : 'PAR'}
                      </span>
                    ) : null}
                    {node.issueCodes.length > 0 ? (
                      <span className="wbs__flag" title={node.issueCodes.join(', ')} />
                    ) : null}
                  </span>

                  <span className="wbs__cell">{node.pic ?? ''}</span>
                  <span className="wbs__cell wbs__status" data-status={node.status}>
                    {node.status.replace('_', ' ')}
                  </span>
                  <span className="wbs__cell wbs__cell--num wbs__pct">
                    {/* Thanh nền vẽ bằng phần tử thật thay vì CSS custom property: TS đòi
                        ép kiểu cho `--pct` trong `style`, còn eslint lại bảo phép ép đó
                        thừa. Một phần tử là đủ — virtualizer chỉ vẽ khoảng 30 dòng. */}
                    <span className="wbs__pctBar" style={{ width: `${node.percent}%` }} />
                    <span className="wbs__pctText">
                      {node.percent === 0 ? '' : node.percent.toFixed(0)}
                    </span>
                  </span>
                  <span className="wbs__cell wbs__cell--num">{node.effortMd ?? ''}</span>
                  <span className="wbs__cell wbs__cell--num">{node.planStart ?? ''}</span>
                  <span className="wbs__cell wbs__cell--num">{node.planEnd ?? ''}</span>
                  <span className="wbs__cell wbs__cell--num">{node.totalFloat ?? ''}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
