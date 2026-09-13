-- 001_init.sql — initial schema, SPEC.md §4.2.
--
-- Never edit this file once merged (CLAUDE.md §3). Schema changes go into a new
-- numbered migration.
--
-- Forward references (location -> calendar, progress -> app_user) are fine:
-- SQLite resolves foreign key targets at DML time, not at CREATE TABLE time.

-- ══════════ Locations & calendars ══════════

CREATE TABLE location (
  id            TEXT PRIMARY KEY,                    -- 'VN', 'JP'
  name          TEXT NOT NULL,
  timezone      TEXT NOT NULL,                       -- 'Asia/Ho_Chi_Minh'
  calendar_id   TEXT NOT NULL REFERENCES calendar(id)
);

CREATE TABLE calendar (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  scope         TEXT NOT NULL CHECK(scope IN ('project','location','resource')),
  parent_id     TEXT REFERENCES calendar(id),
  -- 7 chars Mon..Sun, each is a normalised capacity: 0 | 0.5 | 1.
  -- NULL means inherit entirely from parent.
  week_pattern  TEXT DEFAULT '1111100'
);

CREATE TABLE calendar_exception (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  calendar_id   TEXT NOT NULL REFERENCES calendar(id) ON DELETE CASCADE,
  date_from     TEXT NOT NULL,
  date_to       TEXT NOT NULL,
  capacity      REAL NOT NULL,                       -- 0 off | 0.5 half day | 1 working
  kind          TEXT NOT NULL CHECK(kind IN ('holiday','leave','overtime','other')),
  note          TEXT
);
CREATE INDEX idx_cal_exc ON calendar_exception(calendar_id, date_from, date_to);

-- ══════════ Projects ══════════

CREATE TABLE project (
  id                    TEXT PRIMARY KEY,
  code                  TEXT NOT NULL UNIQUE,        -- 'UTG', 'GEO'
  name                  TEXT NOT NULL,
  priority              INTEGER NOT NULL,            -- 1 = highest when competing for resources
  status                TEXT NOT NULL DEFAULT 'planning'
                        CHECK(status IN ('planning','active','onhold','closed')),
  start_date            TEXT NOT NULL,
  target_end            TEXT,
  status_date           TEXT NOT NULL,               -- data date, set by PM
  calendar_id           TEXT NOT NULL REFERENCES calendar(id),
  default_location      TEXT NOT NULL REFERENCES location(id),
  default_max_parallel  INTEGER NOT NULL DEFAULT 2,
  min_allocation        REAL    NOT NULL DEFAULT 0.25,
  dependency_max_level  INTEGER NOT NULL DEFAULT 3,  -- §6.2
  micro_task_threshold  REAL    NOT NULL DEFAULT 0.5,-- §7.9
  created_at            TEXT NOT NULL
);

-- ══════════ People ══════════

-- A team belongs to ONE project. Organisational unit only; takes no part in
-- schedule computation (§5.1).
CREATE TABLE team (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,                       -- 'BE', 'Mobile', 'QA'
  UNIQUE(project_id, name)
);

-- Resources are GLOBAL: no project_id. Two projects share the same pool (§7.12),
-- and one person's capacity is shared across every project they work on (§5.2).
CREATE TABLE resource (
  id             TEXT PRIMARY KEY,                   -- 'R-dev-01'
  name           TEXT NOT NULL,
  location_id    TEXT NOT NULL REFERENCES location(id),
  calendar_id    TEXT REFERENCES calendar(id),       -- NULL = inherit location calendar
  daily_capacity REAL NOT NULL DEFAULT 1.0,          -- 1.0 full-time
  max_parallel   INTEGER,                            -- NULL = use project default
  available_from TEXT,
  available_to   TEXT,
  cost_per_md    REAL
);

-- One person can be in several teams, but exactly one team per project.
CREATE TABLE resource_team (
  resource_id   TEXT NOT NULL REFERENCES resource(id) ON DELETE CASCADE,
  project_id    TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  team_id       TEXT NOT NULL REFERENCES team(id) ON DELETE CASCADE,
  PRIMARY KEY (resource_id, project_id)
);

CREATE TABLE resource_role (
  resource_id   TEXT NOT NULL REFERENCES resource(id) ON DELETE CASCADE,
  role          TEXT NOT NULL,                       -- 'BrSE','Dev','QA','Designer','TechLead'
  proficiency   REAL NOT NULL DEFAULT 1.0,           -- 1.0 standard; 1.2 is 20% slower
  PRIMARY KEY (resource_id, role)
);

-- ══════════ Tasks ══════════

CREATE TABLE task (
  uid              TEXT PRIMARY KEY,                 -- permanently stable, 'T-0042'
  project_id       TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  wbs_code         TEXT NOT NULL,                    -- '2.1.3', engine-generated, NEVER hand-edited
  depth            INTEGER NOT NULL,                 -- derived, cached for fast queries
  parent_uid       TEXT REFERENCES task(uid),
  sort_order       INTEGER NOT NULL,
  name             TEXT NOT NULL,
  description      TEXT,
  kind             TEXT NOT NULL CHECK(kind IN ('summary','work','milestone')),
  effort_md        REAL,                             -- NULL for summary; >= 0 for work/milestone
  role             TEXT,
  category         TEXT,
  phase            TEXT,
  module           TEXT,
  location_id      TEXT REFERENCES location(id),     -- NULL = derive from assignee
  child_sequencing TEXT CHECK(child_sequencing IN ('parallel','sequential')),
                                                     -- summary only. NULL = parallel. §6.3
  priority         INTEGER NOT NULL DEFAULT 500,     -- 1 = highest
  pinned_resource  TEXT REFERENCES resource(id),
  constraint_type  TEXT CHECK(constraint_type IN ('ASAP','SNET','FNLT','MSO')),
  constraint_date  TEXT,
  external_ref     TEXT,                             -- free-form reference, e.g. Jira key
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX idx_task_parent  ON task(parent_uid);
CREATE INDEX idx_task_wbs     ON task(project_id, wbs_code);
CREATE INDEX idx_task_depth   ON task(project_id, depth);

CREATE TABLE dependency (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  pred_uid      TEXT NOT NULL REFERENCES task(uid) ON DELETE CASCADE,
  succ_uid      TEXT NOT NULL REFERENCES task(uid) ON DELETE CASCADE,
  type          TEXT NOT NULL CHECK(type IN ('FS','SS','FF','SF')),
  lag_days      REAL NOT NULL DEFAULT 0,             -- negative = lead
  UNIQUE(pred_uid, succ_uid, type)
);

-- ══════════ Engine output (engine writes, nobody else — N5) ══════════

CREATE TABLE schedule (
  task_uid             TEXT PRIMARY KEY REFERENCES task(uid) ON DELETE CASCADE,
  es TEXT, ef TEXT,                                  -- CPM, before resource levelling
  ls TEXT, lf TEXT,
  total_float          REAL,
  free_float           REAL,
  is_critical          INTEGER NOT NULL DEFAULT 0,
  start_date           TEXT,                         -- final schedule, resources applied
  end_date             TEXT,
  duration_days        REAL,
  is_resource_critical INTEGER NOT NULL DEFAULT 0,
  delay_reason         TEXT,                         -- §7.6
  blocking_ref         TEXT,                         -- task uid | resource_id | project_id
  computed_at          TEXT NOT NULL
);

-- Exactly ONE person per task (§7.8, decision 6).
CREATE TABLE assignment (
  task_uid      TEXT PRIMARY KEY REFERENCES task(uid) ON DELETE CASCADE,
  resource_id   TEXT NOT NULL REFERENCES resource(id),
  allocation    REAL NOT NULL,                       -- 0.25 .. 1.0
  from_date     TEXT NOT NULL,
  to_date       TEXT NOT NULL,
  is_pinned     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_asg_res ON assignment(resource_id, from_date, to_date);

-- ══════════ Progress (humans write, engine never does — §7.11) ══════════

CREATE TABLE progress (
  task_uid      TEXT PRIMARY KEY REFERENCES task(uid) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'not_started'
                CHECK(status IN ('not_started','in_progress','done','blocked','cancelled')),
  percent       REAL NOT NULL DEFAULT 0 CHECK(percent BETWEEN 0 AND 100),
  actual_start  TEXT,
  actual_end    TEXT,
  remaining_md  REAL,                                -- NULL = derive from percent
  blocked_note  TEXT,
  updated_by    TEXT REFERENCES app_user(id),
  source        TEXT CHECK(source IN ('ui','api','mcp')),
  updated_at    TEXT NOT NULL
);
-- No progress row may exist for kind='summary'. Importer and API reject it.

-- ══════════ Users, permissions, audit ══════════

CREATE TABLE app_user (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  is_admin      INTEGER NOT NULL DEFAULT 0,
  resource_id   TEXT REFERENCES resource(id),
  password_hash TEXT NOT NULL,                       -- argon2id
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL
);
-- pm/lead roles live in user_project: one person can be PM of A and lead of B.

CREATE TABLE user_project (
  user_id       TEXT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  project_id    TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  role          TEXT NOT NULL CHECK(role IN ('pm','lead','viewer')),
  team_id       TEXT REFERENCES team(id),            -- lead: write scope
  PRIMARY KEY (user_id, project_id)
);

CREATE TABLE audit_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  at            TEXT NOT NULL,
  user_id       TEXT NOT NULL REFERENCES app_user(id),
  entity        TEXT NOT NULL,
  entity_id     TEXT NOT NULL,
  action        TEXT NOT NULL CHECK(action IN ('create','update','delete')),
  field         TEXT,
  old_value     TEXT,
  new_value     TEXT
);
CREATE INDEX idx_audit      ON audit_log(entity, entity_id, at);
CREATE INDEX idx_audit_user ON audit_log(user_id, at);

-- ══════════ Baseline & validation ══════════

CREATE TABLE baseline (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  label         TEXT NOT NULL,                       -- 'Plan v1.0'
  status_date   TEXT NOT NULL,
  taken_by      TEXT NOT NULL REFERENCES app_user(id),
  taken_at      TEXT NOT NULL,
  is_hidden     INTEGER NOT NULL DEFAULT 0,
  snapshot_json TEXT NOT NULL                        -- task + schedule + progress
);

CREATE TABLE validation_issue (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id        TEXT NOT NULL,
  project_id    TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  severity      TEXT NOT NULL CHECK(severity IN ('Critical','Major','Minor')),
  code          TEXT NOT NULL,
  task_uid      TEXT,
  message       TEXT NOT NULL,                       -- English
  detail_json   TEXT,
  detected_at   TEXT NOT NULL
);

-- ══════════ Triggers ══════════

-- §4.2 requires resource_team.project_id to match the team's own project.
-- A composite foreign key cannot express this because team's primary key is its
-- id alone, so enforce it with a trigger on both INSERT and UPDATE.
-- `IS NOT` (not `!=`) so a missing team also aborts instead of comparing to NULL.
CREATE TRIGGER trg_resource_team_project_ins
BEFORE INSERT ON resource_team
FOR EACH ROW
WHEN (SELECT project_id FROM team WHERE id = NEW.team_id) IS NOT NEW.project_id
BEGIN
  SELECT RAISE(ABORT, 'resource_team.project_id must match team.project_id');
END;

CREATE TRIGGER trg_resource_team_project_upd
BEFORE UPDATE ON resource_team
FOR EACH ROW
WHEN (SELECT project_id FROM team WHERE id = NEW.team_id) IS NOT NEW.project_id
BEGIN
  SELECT RAISE(ABORT, 'resource_team.project_id must match team.project_id');
END;
