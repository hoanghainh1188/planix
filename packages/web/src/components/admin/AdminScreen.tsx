import { useState, type JSX } from 'react';
import type {
  AdminCalendar,
  AdminLocation,
  AdminResource,
  CalendarException,
  SaveResourceInput,
} from '../../data/types.js';
import './admin.css';

/**
 * S5 — Resources & calendars (§10.3, toàn cục, admin).
 *
 * §10 không đặc tả màn này; phạm vi do PM chốt ngày 2026-09-14: **cả hai khu trong một
 * màn**, đúng như tên §10.3 đặt.
 *
 * ## Vì sao khu lịch nghỉ quan trọng hơn nó trông
 *
 * Trước màn này, `CAL-VN` có **0 ngày nghỉ** và toàn hệ thống có **0 dòng nghỉ phép**.
 * Engine coi cả Tết là ngày làm việc bình thường, tức mọi lịch của đội VN sai khoảng 11+
 * ngày mỗi năm — âm thầm. Cách vá duy nhất là sửa tay SQLite.
 *
 * `vn-2026.json` có sẵn nhưng khai `complete: false` vì ngày Tết phụ thuộc thông báo của
 * Chính phủ, và `resolveSeed` từ chối nạp seed chưa đủ — một chốt chặn ĐÚNG (seed thiếu
 * Tết trông y hệt seed đủ) nhưng nó biến thành ngõ cụt khi không có đường nhập tay.
 */

type Tab = 'people' | 'calendars';

const KINDS: ReadonlyArray<{ id: CalendarException['kind']; label: string }> = [
  { id: 'holiday', label: 'Holiday' },
  { id: 'leave', label: 'Leave' },
  { id: 'overtime', label: 'Overtime' },
  { id: 'other', label: 'Other' },
];

export interface AdminScreenProps {
  readonly resources: readonly AdminResource[];
  readonly calendars: readonly AdminCalendar[];
  readonly locations: readonly AdminLocation[];
  readonly exceptions: readonly CalendarException[];
  readonly loading: boolean;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onSaveResource: (input: SaveResourceInput) => Promise<void>;
  readonly onAddException: (input: {
    calendarId: string;
    dateFrom: string;
    dateTo: string;
    capacity: number;
    kind: CalendarException['kind'];
    note: string | null;
  }) => Promise<void>;
  readonly onAddLeave: (input: {
    resourceId: string;
    dateFrom: string;
    dateTo: string;
    note: string | null;
  }) => Promise<void>;
  readonly onRemoveException: (id: number) => Promise<void>;
}

export function AdminScreen(props: AdminScreenProps): JSX.Element {
  const [tab, setTab] = useState<Tab>('people');

  return (
    <section className="admin" aria-label="Resources and calendars">
      <div className="admin__intro">
        <h1 className="admin__title">Resources &amp; calendars</h1>
        <p className="admin__lead">
          These belong to the organisation, not to one project (§10.3). A person&rsquo;s working
          days come from their location&rsquo;s calendar, with their own leave on top.
        </p>
      </div>

      <div className="admin__tabs" role="tablist" aria-label="Section">
        <button
          type="button"
          role="tab"
          className="admin__tab"
          aria-selected={tab === 'people'}
          onClick={() => setTab('people')}
        >
          People <b>{props.resources.length}</b>
        </button>
        <button
          type="button"
          role="tab"
          className="admin__tab"
          aria-selected={tab === 'calendars'}
          onClick={() => setTab('calendars')}
        >
          Calendars <b>{props.exceptions.length}</b>
        </button>
      </div>

      {props.error === null ? null : (
        <p className="admin__error" role="alert">
          {props.error}
        </p>
      )}

      {props.loading ? (
        <p className="admin__empty">Loading…</p>
      ) : tab === 'people' ? (
        <PeopleSection {...props} />
      ) : (
        <CalendarSection {...props} />
      )}
    </section>
  );
}

function PeopleSection(props: AdminScreenProps): JSX.Element {
  /** `null` = không sửa ai. Một chuỗi = id người đang sửa. `''` = đang thêm mới. */
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <>
      <div className="admin__bar">
        <button
          type="button"
          className="admin__button admin__button--go"
          disabled={props.busy}
          onClick={() => setEditing('')}
        >
          Add a person
        </button>
      </div>

      {editing === null ? null : (
        <ResourceForm
          // `key` buộc form dựng lại khi đổi người: bản nháp trong nó phải bị vứt, nếu
          // không thì bấm Save là ghi dữ liệu người cũ đè lên người mới.
          key={editing}
          existing={props.resources.find((r) => r.id === editing) ?? null}
          locations={props.locations}
          knownRoles={[...new Set(props.resources.flatMap((r) => r.roles))].sort()}
          busy={props.busy}
          onCancel={() => setEditing(null)}
          onSave={async (input) => {
            await props.onSaveResource(input);
            setEditing(null);
          }}
        />
      )}

      <div className="admin__tableWrap">
        <table className="admin__table">
          <thead>
            <tr>
              <th scope="col">ID</th>
              <th scope="col">Name</th>
              <th scope="col">Location</th>
              <th scope="col">Roles</th>
              <th scope="col">Capacity</th>
              <th scope="col">Max parallel</th>
              <th scope="col">Available</th>
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            {props.resources.map((r) => (
              <tr key={r.id}>
                <td className="admin__mono">{r.id}</td>
                <td>{r.name}</td>
                <td>{r.locationId}</td>
                <td>{r.roles.join(', ')}</td>
                <td className="admin__num">{r.dailyCapacity}</td>
                <td className="admin__num">{r.maxParallel ?? '—'}</td>
                <td className="admin__mono">
                  {r.availableFrom === null && r.availableTo === null
                    ? 'always'
                    : `${r.availableFrom ?? '…'} → ${r.availableTo ?? '…'}`}
                </td>
                <td>
                  <button
                    type="button"
                    className="admin__link"
                    disabled={props.busy}
                    onClick={() => setEditing(r.id)}
                  >
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ResourceForm({
  existing,
  locations,
  knownRoles,
  busy,
  onSave,
  onCancel,
}: {
  readonly existing: AdminResource | null;
  readonly locations: readonly AdminLocation[];
  readonly knownRoles: readonly string[];
  readonly busy: boolean;
  readonly onSave: (input: SaveResourceInput) => Promise<void>;
  readonly onCancel: () => void;
}): JSX.Element {
  const creating = existing === null;
  const [id, setId] = useState(existing?.id ?? '');
  const [name, setName] = useState(existing?.name ?? '');
  const [locationId, setLocationId] = useState(existing?.locationId ?? locations[0]?.id ?? '');
  const [roles, setRoles] = useState(existing?.roles.join(', ') ?? '');
  const [dailyCapacity, setDailyCapacity] = useState(String(existing?.dailyCapacity ?? 1));
  const [maxParallel, setMaxParallel] = useState(
    existing?.maxParallel === null || existing?.maxParallel === undefined
      ? ''
      : String(existing.maxParallel),
  );
  const [availableFrom, setAvailableFrom] = useState(existing?.availableFrom ?? '');
  const [availableTo, setAvailableTo] = useState(existing?.availableTo ?? '');

  const roleList = roles
    .split(',')
    .map((x) => x.trim())
    .filter((x) => x !== '');
  const ready = id.trim() !== '' && name.trim() !== '' && locationId !== '' && roleList.length > 0;

  return (
    <form
      className="admin__form"
      aria-label={creating ? 'Add a person' : `Edit ${existing.name}`}
      onSubmit={(e) => {
        e.preventDefault();
        void onSave({
          id: id.trim(),
          name: name.trim(),
          locationId,
          roles: roleList,
          dailyCapacity: Number(dailyCapacity),
          maxParallel: maxParallel.trim() === '' ? null : Number(maxParallel),
          availableFrom: availableFrom === '' ? null : availableFrom,
          availableTo: availableTo === '' ? null : availableTo,
          costPerMd: existing?.costPerMd ?? null,
          create: creating,
        });
      }}
    >
      <label className="admin__field">
        <span className="admin__label">ID</span>
        <input
          className="admin__input"
          value={id}
          // Id là khoá chính và là thứ `assignment` trỏ tới — đổi nó sau khi tạo sẽ bỏ
          // rơi mọi phân bổ đang có, nên khoá lại khi sửa.
          disabled={!creating || busy}
          onChange={(e) => setId(e.target.value)}
        />
      </label>
      <label className="admin__field">
        <span className="admin__label">Name</span>
        <input
          className="admin__input"
          value={name}
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="admin__field">
        <span className="admin__label">Location</span>
        <select
          className="admin__input"
          value={locationId}
          disabled={busy}
          onChange={(e) => setLocationId(e.target.value)}
        >
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.id} — {l.name}
            </option>
          ))}
        </select>
      </label>
      <label className="admin__field admin__field--wide">
        <span className="admin__label">
          Roles
          <i className="admin__hint">
            comma separated{knownRoles.length === 0 ? '' : ` · in use: ${knownRoles.join(', ')}`}
          </i>
        </span>
        <input
          className="admin__input"
          value={roles}
          disabled={busy}
          onChange={(e) => setRoles(e.target.value)}
        />
      </label>
      <label className="admin__field">
        <span className="admin__label">Daily capacity</span>
        <input
          className="admin__input"
          type="number"
          step="0.5"
          min="0.5"
          max="2"
          value={dailyCapacity}
          disabled={busy}
          onChange={(e) => setDailyCapacity(e.target.value)}
        />
      </label>
      <label className="admin__field">
        <span className="admin__label">
          Max parallel<i className="admin__hint">blank = project default</i>
        </span>
        <input
          className="admin__input"
          type="number"
          min="1"
          value={maxParallel}
          disabled={busy}
          onChange={(e) => setMaxParallel(e.target.value)}
        />
      </label>
      <label className="admin__field">
        <span className="admin__label">Available from</span>
        <input
          className="admin__input"
          type="date"
          value={availableFrom}
          disabled={busy}
          onChange={(e) => setAvailableFrom(e.target.value)}
        />
      </label>
      <label className="admin__field">
        <span className="admin__label">Available to</span>
        <input
          className="admin__input"
          type="date"
          value={availableTo}
          disabled={busy}
          onChange={(e) => setAvailableTo(e.target.value)}
        />
      </label>

      <div className="admin__actions">
        <button type="submit" className="admin__button admin__button--go" disabled={!ready || busy}>
          {busy ? 'Saving…' : creating ? 'Create' : 'Save'}
        </button>
        <button type="button" className="admin__button" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function CalendarSection(props: AdminScreenProps): JSX.Element {
  /**
   * Hai cách ghi một ngày nghỉ, và chúng khác nhau ở nơi dữ liệu đi tới:
   *
   *   - **Calendar**: ngày lễ của cả một địa điểm — ai ở đó cũng nghỉ.
   *   - **Person**: nghỉ phép của riêng một người; §5.2 để nó trong một lịch cá nhân,
   *     và lịch đó được tạo tự động nếu người ấy chưa có.
   */
  const [target, setTarget] = useState<'calendar' | 'person'>('calendar');
  const [calendarId, setCalendarId] = useState(props.calendars[0]?.id ?? '');
  const [resourceId, setResourceId] = useState(props.resources[0]?.id ?? '');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [kind, setKind] = useState<CalendarException['kind']>('holiday');
  const [note, setNote] = useState('');

  const ready = dateFrom !== '' && dateTo !== '' && dateFrom <= dateTo;
  const nameOf = (id: string): string => props.calendars.find((c) => c.id === id)?.name ?? id;

  return (
    <>
      <form
        className="admin__form"
        aria-label="Add a non-working day"
        onSubmit={(e) => {
          e.preventDefault();
          const trimmed = note.trim() === '' ? null : note.trim();
          const done = (): void => {
            setDateFrom('');
            setDateTo('');
            setNote('');
          };
          if (target === 'person') {
            void props.onAddLeave({ resourceId, dateFrom, dateTo, note: trimmed }).then(done);
          } else {
            void props
              .onAddException({
                calendarId,
                dateFrom,
                dateTo,
                // Ngày nghỉ là năng lực 0; `overtime` thì ngược lại.
                capacity: kind === 'overtime' ? 1 : 0,
                kind,
                note: trimmed,
              })
              .then(done);
          }
        }}
      >
        <label className="admin__field">
          <span className="admin__label">Applies to</span>
          <select
            className="admin__input"
            value={target}
            disabled={props.busy}
            onChange={(e) => {
              const next = e.target.value === 'person' ? 'person' : 'calendar';
              setTarget(next);
              // Nghỉ phép của một người không phải "holiday" — đổi nhãn theo cho khỏi
              // ghi nhầm loại.
              setKind(next === 'person' ? 'leave' : 'holiday');
            }}
          >
            <option value="calendar">A whole calendar</option>
            <option value="person">One person</option>
          </select>
        </label>

        {target === 'calendar' ? (
          <label className="admin__field">
            <span className="admin__label">Calendar</span>
            <select
              className="admin__input"
              value={calendarId}
              disabled={props.busy}
              onChange={(e) => setCalendarId(e.target.value)}
            >
              {props.calendars.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.id} — {c.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="admin__field">
            <span className="admin__label">
              Person<i className="admin__hint">a personal calendar is created if needed</i>
            </span>
            <select
              className="admin__input"
              value={resourceId}
              disabled={props.busy}
              onChange={(e) => setResourceId(e.target.value)}
            >
              {props.resources.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.id} — {r.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="admin__field">
          <span className="admin__label">Kind</span>
          <select
            className="admin__input"
            value={kind}
            disabled={props.busy}
            onChange={(e) => setKind(e.target.value as CalendarException['kind'])}
          >
            {KINDS.filter((k) => (target === 'person' ? k.id !== 'holiday' : true)).map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <label className="admin__field">
          <span className="admin__label">From</span>
          <input
            className="admin__input"
            type="date"
            value={dateFrom}
            disabled={props.busy}
            onChange={(e) => {
              setDateFrom(e.target.value);
              // Một ngày là trường hợp thường gặp nhất; điền sẵn để khỏi gõ hai lần.
              if (dateTo === '' || dateTo < e.target.value) setDateTo(e.target.value);
            }}
          />
        </label>
        <label className="admin__field">
          <span className="admin__label">To</span>
          <input
            className="admin__input"
            type="date"
            value={dateTo}
            disabled={props.busy}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </label>
        <label className="admin__field admin__field--wide">
          <span className="admin__label">Note</span>
          <input
            className="admin__input"
            value={note}
            placeholder="e.g. Tết Nguyên đán"
            disabled={props.busy}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>

        <div className="admin__actions">
          <button
            type="submit"
            className="admin__button admin__button--go"
            disabled={!ready || props.busy}
          >
            {props.busy ? 'Saving…' : 'Add'}
          </button>
        </div>
      </form>

      <div className="admin__tableWrap">
        <table className="admin__table">
          <thead>
            <tr>
              <th scope="col">From</th>
              <th scope="col">To</th>
              <th scope="col">Calendar</th>
              <th scope="col">Kind</th>
              <th scope="col">Capacity</th>
              <th scope="col">Note</th>
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            {props.exceptions.length === 0 ? (
              <tr>
                <td colSpan={7} className="admin__empty">
                  No non-working days recorded yet. Until there are, the engine treats every weekday
                  as a working day.
                </td>
              </tr>
            ) : (
              props.exceptions.map((x) => (
                <tr key={x.id}>
                  <td className="admin__mono">{x.dateFrom}</td>
                  <td className="admin__mono">{x.dateTo}</td>
                  <td>{nameOf(x.calendarId)}</td>
                  <td>{x.kind}</td>
                  <td className="admin__num">{x.capacity}</td>
                  <td>{x.note ?? '—'}</td>
                  <td>
                    <button
                      type="button"
                      className="admin__link"
                      disabled={props.busy}
                      onClick={() => void props.onRemoveException(x.id)}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
