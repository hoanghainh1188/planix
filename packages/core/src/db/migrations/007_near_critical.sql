-- 007_near_critical.sql — nhãn "gần găng" cho đường găng sau san tài nguyên.
--
-- PM chốt phương án (iii) ngày 2026-09-14
-- (`docs/decisions/2026-09-13-resource-critical-path-chua-co.md` §5): giữ
-- `is_resource_critical` nguyên nghĩa CHẶT để nó còn dùng được cho tính toán, và thêm
-- một nhãn riêng cho phần chuỗi bị cắt vì lệch lịch VN ↔ JP.
--
-- Vì sao cần cột thứ hai chứ không nới cột cũ: công cụ này dành cho đội VN làm với khách
-- Nhật, nên lệch lịch là chuyện thường ngày. Đo trên dev.db, chuỗi UTG đứt tại Silver
-- Week (敬老の日 / 国民の休日 / 秋分の日) và GEO đứt tại 海の日. Ở những chỗ đó
-- predecessor có 1-2 ngày dư THẬT — loại nó khỏi đường găng nghĩa chặt là đúng — nhưng
-- PM vẫn cần thấy phần còn lại của chuỗi.
--
-- Hai cột rời nhau: task đã găng nghĩa chặt thì không mang nhãn này.

ALTER TABLE schedule ADD COLUMN is_resource_near_critical INTEGER NOT NULL DEFAULT 0;
