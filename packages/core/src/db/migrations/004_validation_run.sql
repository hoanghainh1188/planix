-- 004_validation_run.sql — ghi lại LƯỢT validate, không chỉ issue của nó.
--
-- §4.2 chỉ có `validation_issue`. Nhưng bảng đó không phân biệt được hai trạng thái mà
-- PM đọc màn S6 buộc phải phân biệt:
--
--   * dự án SẠCH — đã chạy validate, không có vấn đề nào
--   * dự án CHƯA ai kiểm — chưa từng import, schedule hay lưu progress
--
-- Cả hai đều cho ra không dòng nào. Panel hiện "Không có vấn đề" cho trường hợp thứ hai
-- là nói sai: nó không phải "không có vấn đề" mà là "chưa biết". Với một tool lập kế
-- hoạch, hai câu đó dẫn tới hai quyết định khác nhau.
--
-- Mỗi dự án giữ đúng MỘT dòng — lượt gần nhất. Không giữ lịch sử: người đọc duy nhất
-- chỉ cần lượt mới nhất, và `audit_log` đã lo phần vết ai-sửa-gì.
-- Xem docs/decisions/2026-09-13-luu-ket-qua-validate.md.

CREATE TABLE validation_run (
  project_id TEXT PRIMARY KEY REFERENCES project(id) ON DELETE CASCADE,
  run_id     TEXT NOT NULL,
  ran_at     TEXT NOT NULL,
  -- Đếm sẵn theo mức. Panel hiện con số này ngay cả khi người dùng đang lọc, nên tính
  -- lại từ `validation_issue` mỗi lần đọc là thừa.
  critical   INTEGER NOT NULL DEFAULT 0,
  major      INTEGER NOT NULL DEFAULT 0,
  minor      INTEGER NOT NULL DEFAULT 0
);
