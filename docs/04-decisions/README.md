# Quyết định — lưu câu trả lời từ /speckit-clarify

Mỗi lần /speckit-clarify giải quyết 1 ambiguity, ghi lại tại đây theo format:
docs/04-decisions/<YYYY-MM-DD>-<slug>.md

## Template
# <Tiêu đề ngắn>
- Ngày: YYYY-MM-DD
- Feature liên quan: <ten-feature>
- Câu hỏi gốc: <trích từ Ambiguities của intake>
- Quyết định: <câu trả lời>
- Người quyết định: <tên>

Đây là "long-term memory" cho các mâu thuẫn đã xử lý — tránh hỏi lại ở feature sau.

## Mục lục — [`INDEX.md`](INDEX.md)

Mỗi khi thêm 1 file quyết định, **append 1 dòng** vào [`INDEX.md`](INDEX.md) (ngày · quyết định ·
feature · thuật ngữ). `design-intake` và `/speckit-clarify` quét `INDEX.md` **trước** khi hỏi lại —
nếu ambiguity đã có quyết định, dùng lại thay vì hỏi lần nữa (rule 2 + 6 `CLAUDE.md`).
