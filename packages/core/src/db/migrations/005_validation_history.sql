-- planix:no-transaction
-- 005_validation_history.sql — giữ LỊCH SỬ các lượt validate, không chỉ lượt cuối.
--
-- PM quyết ngày 2026-09-13: cần trả lời được "issue này xuất hiện từ bao giờ".
-- Migration 004 chỉ giữ đúng một dòng mỗi dự án (`project_id` là PRIMARY KEY), nên câu
-- hỏi đó không trả lời được. Ở đây đổi sang nhiều dòng mỗi dự án.
--
-- Ba cột mới, mỗi cột giải một vấn đề cụ thể:
--
--   `source`      — lượt này do đâu mà có: import, schedule, lưu progress, hay sửa WBS.
--                   PM quyết cho validate chạy sau MỌI thao tác ghi, nên nếu không ghi
--                   nguồn thì không phân biệt được "lịch vừa tính lại" với "ai đó vừa
--                   đổi tên một task".
--
--   `fingerprint` — dấu vân của TẬP issue. Sửa WBS hai mươi lần mà tập issue không đổi
--                   thì đó vẫn là một trạng thái, không phải hai mươi. Trùng vân tay thì
--                   cập nhật `last_at` của dòng cũ chứ không đẻ dòng mới — nếu không,
--                   "lịch sử" chỉ là tiếng ồn và bảng phình theo số lần gõ phím.
--
--   `first_at` / `last_at` — nhờ vân tay, một dòng mang nghĩa "tập issue này xuất hiện
--                   từ `first_at`, còn thấy tới `last_at`". Đó chính là câu PM hỏi.
--
-- Dựng lại bảng vì `project_id` đang là PRIMARY KEY. Không bảng nào tham chiếu tới
-- `validation_run`, nhưng vẫn tắt FK theo đúng bài học của migration 003: `DROP TABLE`
-- khi FK đang bật chạy `DELETE FROM` ngầm và kích hoạt cascade.
--
-- Dữ liệu cũ được chép sang, coi như một lượt `schedule` (004 chưa có cột nguồn) với vân
-- tay rỗng — lượt kế tiếp sẽ tự thay.

PRAGMA foreign_keys = OFF;

BEGIN;

CREATE TABLE validation_run_new (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  run_id      TEXT NOT NULL,
  source      TEXT NOT NULL CHECK(source IN ('import','schedule','progress','edit')),
  first_at    TEXT NOT NULL,
  last_at     TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  critical    INTEGER NOT NULL DEFAULT 0,
  major       INTEGER NOT NULL DEFAULT 0,
  minor       INTEGER NOT NULL DEFAULT 0
);

INSERT INTO validation_run_new
  (project_id, run_id, source, first_at, last_at, fingerprint, critical, major, minor)
SELECT project_id, run_id, 'schedule', ran_at, ran_at, '', critical, major, minor
FROM validation_run;

DROP TABLE validation_run;
ALTER TABLE validation_run_new RENAME TO validation_run;

-- Đọc luôn là "lượt mới nhất của dự án này": sắp giảm dần ngay trong index.
--
-- Sắp theo `id`, KHÔNG theo `last_at`. `last_at` do người gọi truyền vào (`ctx.now`), nên
-- một lần chỉnh đồng hồ lùi — hay một request mang `now` cũ — sẽ khiến lượt mới nhất
-- không phải lượt mới nhất nữa: panel hiện lại trạng thái cũ, và việc khử trùng so với
-- nhầm dòng rồi đẻ ra một dòng lịch sử thừa mỗi lần ghi. `id` tăng đơn điệu theo thứ tự
-- chèn, đúng nghĩa "lượt gần đây nhất".
CREATE INDEX idx_validation_run_project ON validation_run(project_id, id DESC);

-- `validation_issue` phải trỏ tới ĐÚNG một dòng lịch sử.
--
-- `run_id` của §4.2 là mã lượt do engine đặt, và nó KHÔNG duy nhất: hai lượt trong cùng
-- một mili-giây (hoặc trong test, nơi `now` cố định) sinh ra cùng một chuỗi. Khi mỗi dự
-- án chỉ giữ một lượt thì điều đó vô hại; có lịch sử rồi thì issue của hai lượt khác nhau
-- lẫn vào nhau và panel hiện lẫn lộn.
--
-- Thêm khoá thật trỏ vào `validation_run.id`. `run_id` giữ nguyên vì §4.2 có nó và nó vẫn
-- là mã lượt của engine — chỉ không còn được dùng để phân biệt lượt.
--
-- `ON DELETE CASCADE` lo luôn việc dọn: cắt bớt lịch sử cũ thì issue của nó đi theo, không
-- cần xoá tay và không sót lại dòng mồ côi.
ALTER TABLE validation_issue ADD COLUMN run_pk INTEGER REFERENCES validation_run(id) ON DELETE CASCADE;
CREATE INDEX idx_validation_issue_run ON validation_issue(run_pk);

-- Dòng cũ (ghi bởi migration 004, khi chưa có lịch sử) được nối vào lượt tương ứng.
UPDATE validation_issue
   SET run_pk = (
     SELECT r.id FROM validation_run r
      WHERE r.project_id = validation_issue.project_id
      ORDER BY r.id DESC LIMIT 1
   );

COMMIT;

PRAGMA foreign_keys = ON;
