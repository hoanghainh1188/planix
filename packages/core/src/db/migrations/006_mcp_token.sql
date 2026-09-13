-- 006_mcp_token.sql — token cho lớp MCP (§12.4).
--
-- §12.4: *"Endpoint bảo vệ bằng bearer token riêng, không dùng session cookie."* Phiên
-- đăng nhập gắn với một người ngồi trước trình duyệt và hết hạn sau 7 ngày (§13.3); một
-- tiến trình AI thì không đăng nhập được và cũng không nên giữ cookie của ai.
--
-- Token vẫn TRỎ TỚI một `app_user`. Không tạo ra một "principal vô danh": §10.6 phân
-- quyền theo cặp (người, dự án), và `audit_log` ghi `user_id`. Một token không gắn với
-- ai sẽ khiến mọi thao tác AI thành không truy nguyên được — đúng thứ vừa phải sửa bằng
-- nhật ký request.
--
-- Lưu HASH, không lưu token. Dùng SHA-256 chứ không argon2 như mật khẩu: token là 32 byte
-- ngẫu nhiên, không phải thứ người ta nghĩ ra, nên không có gì để tấn công từ điển. Và
-- argon2 cố tình chậm — đặt nó lên mọi lời gọi MCP là tự bóp cổ chính mình.
--
-- Không xoá token, chỉ thu hồi: cần biết ai đã gọi gì, kể cả sau khi token hết dùng.

CREATE TABLE mcp_token (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  -- Nhãn người đặt, để phân biệt "token của Claude trên máy PM" với "token của CI".
  label       TEXT NOT NULL,
  token_hash  TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at  TEXT
);

CREATE INDEX idx_mcp_token_hash ON mcp_token(token_hash);
