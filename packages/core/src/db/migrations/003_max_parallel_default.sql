-- planix:no-transaction
--
-- Nâng `project.default_max_parallel` từ 2 lên 4 — PM quyết ngày 2026-09-13.
--
-- Vì sao: WBS nhiều micro task đốt năng lực gấp ~2,7 lần. 12.552 MD trên 30 người xếp
-- thành ~1.140 ngày thay vì 418, vì mỗi người chỉ được chạy 2 task một ngày bất kể task
-- là 0,25 MD hay 3 MD. Xem docs/decisions/2026-09-13-micro-task-capacity-waste.md.
--
-- Vì sao phải dựng lại bảng: SQLite không có `ALTER TABLE ... ALTER COLUMN SET DEFAULT`.
-- Chỉ `UPDATE` các dòng hiện có thì dự án TẠO MỚI về sau vẫn nhận giá trị 2 — một cái bẫy
-- im lặng, vì không ai nhìn vào DDL khi thêm một dự án.
--
-- Vì sao cần tắt foreign key: `DROP TABLE` khi FK đang bật sẽ chạy `DELETE FROM` ngầm và
-- KÍCH HOẠT `ON DELETE CASCADE` — tức là xoá sạch task, dependency, schedule. Tắt FK là
-- bắt buộc, và pragma đó bị bỏ qua nếu đang ở trong transaction; nên file này tự lo
-- giao dịch của mình.
--
-- Chạy hai lần vẫn ra một kết quả: bảng mới luôn được dựng từ đầu và chép lại toàn bộ dữ liệu.

PRAGMA foreign_keys = OFF;

BEGIN;

CREATE TABLE project_new (
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
  default_max_parallel  INTEGER NOT NULL DEFAULT 4,  -- 2 -> 4, PM quyet 2026-09-13
  min_allocation        REAL    NOT NULL DEFAULT 0.25,
  dependency_max_level  INTEGER NOT NULL DEFAULT 3,  -- §6.2
  micro_task_threshold  REAL    NOT NULL DEFAULT 0.5,-- §7.9
  created_at            TEXT NOT NULL
);

INSERT INTO project_new (id, code, name, priority, status, start_date, target_end, status_date, calendar_id, default_location, default_max_parallel, min_allocation, dependency_max_level, micro_task_threshold, created_at)
SELECT id,
       code,
       name,
       priority,
       status,
       start_date,
       target_end,
       status_date,
       calendar_id,
       default_location,
       CASE WHEN default_max_parallel = 2 THEN 4 ELSE default_max_parallel END,
       min_allocation,
       dependency_max_level,
       micro_task_threshold,
       created_at
FROM project;

DROP TABLE project;
ALTER TABLE project_new RENAME TO project;

COMMIT;

-- Bật lại và kiểm: nếu phép dựng lại làm mồ côi khoá ngoại nào thì lệnh này báo lỗi.
PRAGMA foreign_keys = ON;
PRAGMA foreign_key_check;
