import { useState, type JSX } from 'react';
import type { ImportCheck, ImportDone } from '../../data/types.js';
import './import.css';

/** "1 task" / "2 tasks". Một chữ `s` thừa làm cả màn hình trông như chưa làm xong. */
function plural(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? '' : 's'}`;
}

export interface ImportScreenProps {
  /** Kết quả lần kiểm gần nhất. `null` khi chưa kiểm, hoặc khi nội dung đã đổi từ lúc kiểm. */
  readonly check: ImportCheck | null;
  readonly done: ImportDone | null;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onCheck: (payloadText: string) => Promise<void>;
  readonly onCommit: (payloadText: string) => Promise<void>;
  /** Gọi khi nội dung thay đổi — kết quả kiểm cũ không còn mô tả thứ đang nằm trong ô. */
  readonly onDirty: () => void;
}

/**
 * S8 — nạp danh sách task do AI sinh (§9).
 *
 * §9.1: "AI chỉ được xuất JSON đúng schema". PM nhận file đó qua chat rồi đưa vào tool.
 * Trước màn này, đường duy nhất là `cli import` chạy trên máy chủ — PM không có shell thì
 * không nạp được gì.
 *
 * Hai bước, không phải một: **kiểm** rồi mới **nạp**. Cùng nguyên tắc §10.1 dùng cho
 * recalculate — hiện hậu quả trước khi ghi. Với `replace-subtree` thì đây không phải hình
 * thức: nó xoá sạch cây con của `root_uid` (§9.5) và kéo theo tiến độ đã nhập, thứ tính
 * lại không được.
 */
export function ImportScreen({
  check,
  done,
  busy,
  error,
  onCheck,
  onCommit,
  onDirty,
}: ImportScreenProps): JSX.Element {
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);

  function replaceText(next: string, name: string | null): void {
    setText(next);
    setFileName(name);
    // Kết quả kiểm cũ mô tả nội dung CŨ. Giữ nó lại khi nội dung đã đổi là cách chắc chắn
    // để PM kiểm file này rồi nạp file kia.
    onDirty();
  }

  async function pickFile(file: File | undefined): Promise<void> {
    if (file === undefined) return;
    replaceText(await file.text(), file.name);
  }

  const canSubmit = text.trim() !== '' && !busy;

  return (
    <section className="import" aria-label="Import a task list">
      <div className="import__intro">
        <h1 className="import__title">Import a task list</h1>
        <p className="import__lead">
          Paste the JSON your assistant produced, or choose the file. Nothing is written until you
          check it first.
        </p>
      </div>

      <div className="import__source">
        <label className="import__file">
          <input
            type="file"
            accept="application/json,.json"
            className="import__fileInput"
            onChange={(e) => void pickFile(e.target.files?.[0])}
          />
          <span className="import__fileButton">Choose a file…</span>
          <span className="import__fileName">{fileName ?? 'No file chosen'}</span>
        </label>

        <textarea
          className="import__text"
          aria-label="Task list JSON"
          spellCheck={false}
          placeholder={
            '{\n  "version": "1.0",\n  "project_code": "UTG",\n  "mode": "merge",\n  "tasks": [ … ]\n}'
          }
          value={text}
          onChange={(e) => {
            // Gõ tay thì không còn là nội dung của file đã chọn nữa.
            replaceText(e.target.value, null);
          }}
        />

        <div className="import__actions">
          <button
            type="button"
            className="import__button"
            disabled={!canSubmit}
            onClick={() => void onCheck(text)}
          >
            {busy ? 'Working…' : 'Check this file'}
          </button>
          {check !== null && check.ok ? (
            <button
              type="button"
              className="import__button import__button--go"
              disabled={busy}
              onClick={() => void onCommit(text)}
            >
              {check.removing === null
                ? `Import ${plural(check.tasksAdded, 'task')}`
                : `Replace and import ${plural(check.tasksAdded, 'task')}`}
            </button>
          ) : null}
        </div>
      </div>

      {error !== null ? (
        <p className="import__panel import__panel--bad" role="alert">
          {error}
        </p>
      ) : null}

      {check !== null ? <CheckResult check={check} /> : null}

      {done !== null ? (
        <p className="import__panel import__panel--good" role="status">
          Imported {plural(done.tasksAdded, 'task')} into {done.projectCode}.
          {done.issues.length > 0
            ? ` The project now has ${plural(done.issues.length, 'open issue')} — see the Issues panel on the WBS screen.`
            : ' No issues found.'}
        </p>
      ) : null}
    </section>
  );
}

function CheckResult({ check }: { readonly check: ImportCheck }): JSX.Element {
  if (!check.ok) {
    return (
      <div className="import__panel import__panel--bad" role="alert">
        <p className="import__panelHead">Nothing was imported.</p>
        <p>{check.message}</p>
        {check.issues.length > 0 ? <IssueList issues={check.issues} /> : null}
      </div>
    );
  }

  return (
    <div className="import__panel" role="status">
      <p className="import__panelHead">
        {check.projectCode} · {check.mode} · {plural(check.tasksAdded, 'task')} would be added
      </p>

      {check.removing === null ? null : (
        /*
         * §9.5 `replace-subtree` xoá con cháu của `root_uid`, và `ON DELETE CASCADE` kéo
         * theo tiến độ. Lịch thì tính lại được; tiến độ do người gõ thì không — nên câu
         * này nói thẳng con số, không nói chung chung "một số dữ liệu".
         */
        <p className="import__warn">
          This replaces a subtree: {plural(check.removing.taskCount, 'task')} will be deleted
          {check.removing.progressRows > 0
            ? `, along with ${String(check.removing.progressRows)} progress ${
                check.removing.progressRows === 1 ? 'entry' : 'entries'
              } that cannot be recomputed`
            : ''}
          .
        </p>
      )}

      {check.issues.length === 0 ? (
        <p className="import__clean">No issues found.</p>
      ) : (
        <IssueList issues={check.issues} />
      )}
    </div>
  );
}

function IssueList({
  issues,
}: {
  readonly issues: ImportCheck extends { issues: infer I } ? I : never;
}): JSX.Element {
  return (
    <ul className="import__issues">
      {issues.map((issue, index) => (
        <li key={`${issue.code}-${String(index)}`} className="import__issue">
          <span className="import__issueCode" data-severity={issue.severity}>
            {issue.code}
          </span>
          <span>
            {issue.message}
            {issue.wbsCode === undefined ? null : (
              <span className="import__issueTask"> {issue.wbsCode}</span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
