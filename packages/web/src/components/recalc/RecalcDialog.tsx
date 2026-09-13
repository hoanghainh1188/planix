import { useEffect, useRef, type JSX } from 'react';
import type { RecalcDiff } from '../../model/recalc-diff.js';
import './recalc.css';

/** Số dòng hiện mỗi dự án. Bảng dài hơn thì PM không đọc, chỉ bấm qua. */
const ROWS_PER_PROJECT = 8;

export interface RecalcDialogProps {
  readonly diff: RecalcDiff;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

function shiftLabel(days: number): string {
  if (days === 0) return 'no change';
  return `${days > 0 ? '+' : ''}${days} d`;
}

export function RecalcDialog({ diff, onConfirm, onCancel }: RecalcDialogProps): JSX.Element {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Escape đóng hộp thoại. Hộp thoại chặn cả màn hình mà chỉ đóng được bằng chuột là
    // bẫy với người dùng bàn phím, và §10.5 cho thấy dự án này coi trọng bàn phím.
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') onCancel();
    }
    document.addEventListener('keydown', onKey);
    // Đưa tiêu điểm vào hộp thoại để phím bấm tới đúng chỗ.
    dialogRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="recalc__backdrop" role="presentation" onClick={onCancel}>
      <div
        className="recalc"
        role="dialog"
        aria-modal="true"
        aria-labelledby="recalc-title"
        ref={dialogRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="recalc__head">
          <h2 className="recalc__title" id="recalc-title">
            Review before saving
          </h2>
          <p className="recalc__lede">
            The engine recomputed the schedule. Nothing is written until you confirm.
          </p>
        </header>

        {diff.touchesOtherProjects ? (
          <p className="recalc__warn">
            This run also moves tasks in other projects. Their PMs are not notified automatically.
          </p>
        ) : null}

        <div className="recalc__body">
          {diff.projects.length === 0 ? (
            <p>Nothing changed.</p>
          ) : (
            diff.projects.map((project) => (
              <section className="recalc__project" key={project.projectId}>
                <div className="recalc__projectHead">
                  <span className="recalc__projectId">{project.projectId}</span>
                  <span className="recalc__lede">
                    {project.slipped.length} moved
                    {project.added.length > 0 ? `, ${project.added.length} added` : ''}
                    {project.removed.length > 0 ? `, ${project.removed.length} removed` : ''}
                  </span>
                  <span
                    className="recalc__shift"
                    data-direction={
                      project.endShiftDays > 0
                        ? 'later'
                        : project.endShiftDays < 0
                          ? 'earlier'
                          : 'none'
                    }
                  >
                    end {project.endBefore ?? '—'} → {project.endAfter ?? '—'} (
                    {shiftLabel(project.endShiftDays)})
                  </span>
                </div>

                <table className="recalc__table">
                  <thead>
                    <tr>
                      <th scope="col">No.</th>
                      <th scope="col">Task</th>
                      <th scope="col">Was</th>
                      <th scope="col">Now</th>
                      <th scope="col">Shift</th>
                    </tr>
                  </thead>
                  <tbody>
                    {project.slipped.slice(0, ROWS_PER_PROJECT).map((slip) => (
                      <tr key={slip.taskUid}>
                        <td className="num">{slip.wbsCode}</td>
                        <td>{slip.name}</td>
                        <td className="num">{slip.from ?? '—'}</td>
                        <td className="num">{slip.to ?? '—'}</td>
                        <td
                          className="num recalc__days"
                          data-direction={slip.days > 0 ? 'later' : 'earlier'}
                        >
                          {shiftLabel(slip.days)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {project.slipped.length > ROWS_PER_PROJECT ? (
                  <p className="recalc__more">
                    and {project.slipped.length - ROWS_PER_PROJECT} more tasks moved
                  </p>
                ) : null}
              </section>
            ))
          )}
        </div>

        <footer className="recalc__foot">
          <span className="recalc__summary">
            {diff.totalSlipped} tasks moved across {diff.projects.length} project
            {diff.projects.length === 1 ? '' : 's'}
          </span>
          <div className="recalc__actions">
            <button type="button" className="recalc__btn" onClick={onCancel}>
              Discard
            </button>
            <button type="button" className="recalc__btn recalc__btn--primary" onClick={onConfirm}>
              Save schedule
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
