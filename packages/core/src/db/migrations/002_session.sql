-- 002_session.sql — phiên đăng nhập.
--
-- §4.2 không định nghĩa bảng này, nhưng §13.3 đòi session cookie hết hạn 7 ngày, nên
-- phải có chỗ lưu. Đặt trong DB chứ không trong RAM: §3.1 chạy một tiến trình Node,
-- và giữ trong RAM nghĩa là mọi người bị đăng xuất mỗi lần deploy.
--
-- `id` là giá trị ngẫu nhiên dài do lớp auth sinh, không phải số tăng dần.

CREATE TABLE session (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  -- Ghi lại để điều tra khi có sự cố; không dùng để xác thực.
  user_agent  TEXT,
  ip          TEXT
);
CREATE INDEX idx_session_user    ON session(user_id);
CREATE INDEX idx_session_expires ON session(expires_at);

-- Lần đăng nhập sai, phục vụ giới hạn 5 lần / 15 phút / IP (§13.3).
--
-- Lưu trong DB chứ không trong RAM vì cùng lý do: khởi động lại tiến trình không được
-- xoá sạch bộ đếm, nếu không thì ai muốn thử mật khẩu chỉ cần đợi một lần deploy.
CREATE TABLE login_attempt (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ip         TEXT NOT NULL,
  email      TEXT,
  at         TEXT NOT NULL,
  successful INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_login_attempt ON login_attempt(ip, at);
