import { useEffect, useMemo, useRef, useState, type JSX, type KeyboardEvent } from 'react';
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

/** Bốn trường §10.4 cho sửa inline. */
export interface TaskEdit {
  readonly name: string;
  readonly effortMd: number | null;
  readonly role: string | null;
  readonly priority: number;
}

export interface WbsTreeProps {
  readonly projectId: string;
  readonly rows: readonly WbsRow[];
  readonly onSelect?: (uid: string) => void;
  readonly selectedUid?: string | null;
  /** Thiếu ba callback dưới đây thì cây chỉ để xem — dùng cho người không có quyền sửa. */
  readonly onEdit?: (uid: string, edit: TaskEdit) => Promise<void>;
  readonly onMove?: (
    uid: string,
    newParentUid: string | null,
    newSortOrder: number,
  ) => Promise<void>;
  readonly onSequencing?: (uid: string, mode: 'parallel' | 'sequential') => Promise<void>;
  /** Thêm task: `parentUid` là cha mới, `afterUid` là anh em đứng ngay trước. */
  readonly onCreate?: (parentUid: string | null, afterUid: string | null) => Promise<void>;
  readonly onDelete?: (uid: string) => Promise<void>;
  /** Mở sẵn ô sửa cho dòng này — dùng ngay sau khi tạo, để PM gõ tên thật. */
  readonly editUid?: string | null;
  readonly onEditDone?: () => void;
  readonly busy?: boolean;
}

export function WbsTree({
  projectId,
  rows,
  onSelect,
  selectedUid,
  onEdit,
  onMove,
  onSequencing,
  onCreate,
  onDelete,
  editUid = null,
  onEditDone,
  busy = false,
}: WbsTreeProps): JSX.Element {
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
  const [editingUid, setEditingUid] = useState<string | null>(null);
  const [draft, setDraft] = useState<TaskEdit | null>(null);
  /**
   * uid đang bị kéo. State để VẼ, ref để ĐỌC trong handler.
   *
   * `dragstart` và `dragover` là sự kiện native và có thể nối nhau trong cùng một nhịp,
   * trước khi React kịp flush `setDragUid`. Khi đó handler đọc `dragUid` vẫn thấy `null`
   * và bỏ qua toàn bộ thao tác kéo — im lặng, không báo gì. Ref cập nhật ngay nên không
   * phụ thuộc vào lúc nào React render lại.
   */
  const [dragUid, setDragUid] = useState<string | null>(null);
  const dragUidRef = useRef<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ uid: string; mode: 'into' | 'before' } | null>(
    null,
  );

  const canEdit = onEdit !== undefined;
  const canMove = onMove !== undefined;

  function startEdit(node: WbsRow): void {
    if (!canEdit) return;
    setEditingUid(node.uid);
    setDraft({
      name: node.name,
      effortMd: node.effortMd,
      role: node.role,
      priority: node.priority,
    });
  }

  function cancelEdit(): void {
    setEditingUid(null);
    setDraft(null);
    onEditDone?.();
  }

  /**
   * Dòng vừa được tạo: mở ô sửa ngay để PM gõ tên, không phải bấm thêm lần nữa.
   *
   * Phải BUNG hết tổ tiên trước. Mặc định cây chỉ mở tới cấp 3 (§10.4), nên task tạo bên
   * trong một summary đang thu gọn sẽ ra đời mà không ai nhìn thấy — bấm "+child" trông
   * như không có tác dụng gì.
   */
  useEffect(() => {
    if (editUid === null) return;
    const node = rows.find((r) => r.uid === editUid);
    if (node === undefined) return;

    const byUid = new Map(rows.map((r) => [r.uid, r]));
    const needed = new Set<string>();
    let cursor = node.parentUid;
    const guard = new Set<string>();
    while (cursor !== null && !guard.has(cursor)) {
      guard.add(cursor);
      needed.add(cursor);
      cursor = byUid.get(cursor)?.parentUid ?? null;
    }
    if ([...needed].some((uid) => !expanded.has(uid))) {
      applyExpanded(new Set([...expanded, ...needed]));
    }

    setEditingUid(node.uid);
    setDraft({
      name: node.name,
      effortMd: node.effortMd,
      role: node.role,
      priority: node.priority,
    });
    // `expanded` cố ý KHÔNG nằm trong deps: thêm nó vào sẽ chạy lại mỗi lần người dùng
    // thu gọn tay, rồi mở lại nhánh đó ngay lập tức. (Chưa cài plugin react-hooks nên
    // không có rule nào để tắt bằng comment.)
  }, [editUid, rows]);

  async function commitEdit(): Promise<void> {
    if (editingUid === null || draft === null || onEdit === undefined) return;
    const uid = editingUid;
    // Đóng ô nhập TRƯỚC khi gọi mạng: giữ nó mở trong lúc chờ khiến người dùng gõ tiếp
    // vào một giá trị sắp bị ghi đè bởi dữ liệu tải lại.
    cancelEdit();
    await onEdit(uid, draft);
  }

  function editKeys(event: KeyboardEvent<HTMLElement>): void {
    // §10.4: "Enter lưu, Esc hủy."
    if (event.key === 'Enter') {
      event.preventDefault();
      void commitEdit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancelEdit();
    }
  }

  async function drop(targetUid: string, mode: 'into' | 'before'): Promise<void> {
    const moving = dragUidRef.current;
    dragUidRef.current = null;
    setDragUid(null);
    setDropTarget(null);
    if (moving === null || onMove === undefined || moving === targetUid) return;

    const target = rows.find((r) => r.uid === targetUid);
    if (target === undefined) return;

    if (mode === 'into') {
      // Thành con CUỐI của dòng được thả vào.
      const last = rows.filter((r) => r.parentUid === targetUid).length;
      await onMove(moving, targetUid, last + 1);
      return;
    }
    // Chen lên TRƯỚC dòng đích, cùng cha với nó. Engine đánh số lại nên chỉ cần một giá
    // trị nhỏ hơn mọi anh em đứng sau; lấy vị trí của đích trong danh sách anh em.
    const siblings = rows.filter((r) => r.parentUid === target.parentUid);
    const index = siblings.findIndex((r) => r.uid === targetUid);
    await onMove(moving, target.parentUid, index);
  }

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
              const isEditing = editingUid === node.uid;

              if (isEditing && draft !== null) {
                return (
                  <div
                    key={node.uid}
                    className="wbs__grid wbs__row wbs__row--editing"
                    role="row"
                    style={{ transform: `translateY(${item.start}px)` }}
                    onKeyDown={editKeys}
                  >
                    <span className="wbs__cell wbs__cell--num">{node.wbsCode}</span>
                    <span
                      className="wbs__cell wbs__name"
                      style={{ paddingLeft: `calc(${node.depth - 1} * 14px + 8px)` }}
                    >
                      <input
                        className="wbs__edit wbs__edit--name"
                        value={draft.name}
                        autoFocus
                        aria-label="Task name"
                        onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                      />
                    </span>
                    <span className="wbs__cell">
                      <input
                        className="wbs__edit"
                        value={draft.role ?? ''}
                        placeholder="Role"
                        aria-label="Role"
                        onChange={(e) => setDraft({ ...draft, role: e.target.value || null })}
                      />
                    </span>
                    <span className="wbs__cell">
                      <input
                        className="wbs__edit"
                        type="number"
                        value={draft.priority}
                        aria-label="Priority"
                        onChange={(e) => setDraft({ ...draft, priority: Number(e.target.value) })}
                      />
                    </span>
                    <span className="wbs__cell" />
                    <span className="wbs__cell wbs__cell--num">
                      <input
                        className="wbs__edit wbs__edit--num"
                        type="number"
                        step="0.25"
                        min="0"
                        value={draft.effortMd ?? ''}
                        aria-label="Effort MD"
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            effortMd: e.target.value === '' ? null : Number(e.target.value),
                          })
                        }
                      />
                    </span>
                    <span className="wbs__cell wbs__hint" style={{ gridColumn: 'span 3' }}>
                      Enter saves · Esc cancels
                    </span>
                  </div>
                );
              }

              return (
                <div
                  key={node.uid}
                  className="wbs__grid wbs__row"
                  role="row"
                  data-critical={node.isCritical}
                  data-kind={node.kind}
                  data-selected={selectedUid === node.uid}
                  data-dragging={dragUid === node.uid}
                  data-drop={dropTarget?.uid === node.uid ? dropTarget.mode : undefined}
                  style={{ transform: `translateY(${item.start}px)` }}
                  onClick={() => onSelect?.(node.uid)}
                  onDoubleClick={() => startEdit(node)}
                  draggable={canMove}
                  onDragStart={(e) => {
                    dragUidRef.current = node.uid;
                    setDragUid(node.uid);
                    e.dataTransfer.effectAllowed = 'move';
                    // Firefox không bắt đầu kéo nếu dataTransfer rỗng.
                    e.dataTransfer.setData('text/plain', node.uid);
                  }}
                  onDragEnd={() => {
                    dragUidRef.current = null;
                    setDragUid(null);
                    setDropTarget(null);
                  }}
                  onDragOver={(e) => {
                    const moving = dragUidRef.current;
                    if (!canMove || moving === null || moving === node.uid) return;
                    e.preventDefault();
                    // Một phần tư trên của dòng = chen lên trước (đổi `sort_order`);
                    // phần còn lại = thả vào trong (đổi cha). Hai việc §10.4 nêu, hai
                    // vùng thả khác nhau, để người dùng chọn được cái mình muốn.
                    const box = e.currentTarget.getBoundingClientRect();
                    const mode = e.clientY - box.top < box.height * 0.25 ? 'before' : 'into';
                    setDropTarget({ uid: node.uid, mode });
                  }}
                  onDragLeave={() => setDropTarget(null)}
                  onDrop={(e) => {
                    e.preventDefault();
                    void drop(node.uid, dropTarget?.uid === node.uid ? dropTarget.mode : 'into');
                  }}
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
                    {node.kind === 'summary' ? (
                      /* §6.3: NULL nghĩa là parallel, nên dòng summary nào cũng có công
                         tắc — kể cả khi chưa ai đặt giá trị. */
                      <button
                        type="button"
                        className="wbs__seq"
                        data-mode={node.childSequencing ?? 'parallel'}
                        disabled={onSequencing === undefined || busy}
                        title={
                          onSequencing === undefined
                            ? 'Sequencing is read-only for your role'
                            : 'Switch parallel / sequential'
                        }
                        onClick={(e) => {
                          e.stopPropagation();
                          void onSequencing?.(
                            node.uid,
                            node.childSequencing === 'sequential' ? 'parallel' : 'sequential',
                          );
                        }}
                      >
                        {node.childSequencing === 'sequential' ? 'SEQ' : 'PAR'}
                      </button>
                    ) : null}
                    {node.linkCount > 0 ? (
                      /* Ràng buộc quyết định ngày của task nhưng không nằm trong cột nào
                         của §10.4. Không có dấu này thì cách duy nhất để biết dòng nào bị
                         nối là mở panel từng dòng một. */
                      <span
                        className="wbs__links"
                        title={`${String(node.linkCount)} dependency ${
                          node.linkCount === 1 ? 'link' : 'links'
                        }`}
                      >
                        ⇄{node.linkCount}
                      </span>
                    ) : null}
                    {node.issueCodes.length > 0 ? (
                      <span className="wbs__flag" title={node.issueCodes.join(', ')} />
                    ) : null}

                    {/* Hiện khi rê chuột: thêm task ở đây, hoặc xoá. Không chiếm cột
                        riêng vì §10.4 đã chốt danh sách cột. */}
                    {onCreate !== undefined || onDelete !== undefined ? (
                      <span className="wbs__actions">
                        {onCreate !== undefined && node.kind === 'summary' ? (
                          <button
                            type="button"
                            className="wbs__act"
                            title="Add a task inside this one"
                            disabled={busy}
                            onClick={(e) => {
                              e.stopPropagation();
                              void onCreate(node.uid, null);
                            }}
                          >
                            +child
                          </button>
                        ) : null}
                        {onCreate !== undefined ? (
                          <button
                            type="button"
                            className="wbs__act"
                            title="Add a task right after this one"
                            disabled={busy}
                            onClick={(e) => {
                              e.stopPropagation();
                              void onCreate(node.parentUid, node.uid);
                            }}
                          >
                            +after
                          </button>
                        ) : null}
                        {onDelete !== undefined ? (
                          <button
                            type="button"
                            className="wbs__act wbs__act--danger"
                            title="Delete this task and everything inside it"
                            disabled={busy}
                            onClick={(e) => {
                              e.stopPropagation();
                              void onDelete(node.uid);
                            }}
                          >
                            ×
                          </button>
                        ) : null}
                      </span>
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
