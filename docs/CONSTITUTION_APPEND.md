# Gợi ý bổ sung cho .specify/memory/constitution.md

Sau khi chạy `/speckit-constitution` lần đầu, cân nhắc thêm các điều dưới đây vào
`.specify/memory/constitution.md` để phù hợp với bối cảnh làm việc với tài liệu Nhật:

## Article X — Terminology fidelity
Mọi thuật ngữ nghiệp vụ tiếng Nhật phải được tra `docs/00-glossary.md` trước khi
sử dụng trong code hay spec. Cấm tự dịch sang tiếng Anh generic không đối chiếu glossary.

## Article Y — Source-of-truth precedence
Khi có mâu thuẫn giữa basic design (基本設計), detail design (詳細設計), và Figma,
KHÔNG được tự chọn 1 bên. Phải nêu vào `/speckit-clarify` để xử lý, và câu trả lời
phải được ghi vào `docs/04-decisions/`.

## Article Z — Intake artifact requirement
Không được gọi `/speckit-specify` trực tiếp cho các feature có tài liệu Nhật/Figma —
phải thông qua subagent `design-intake` để có file intake tại `docs/intake/`.
Điều này đảm bảo mọi spec đều có traceability ngược về tài liệu gốc.

## Article W — Test coverage & TDD
Mọi business logic mới phải có test đi kèm; ưu tiên viết test trước (TDD: RED → GREEN → refactor).
Độ phủ test (coverage) tối thiểu **80%** trên phần business logic (không tính scaffolding /
code generated / file cấu hình). Test gate KHÔNG chỉ đòi test xanh mà phải đạt ngưỡng coverage
này trước khi merge/deploy.

> Ngưỡng 80% là bất biến; *cách đo* coverage tuỳ tech stack — điền lệnh cụ thể của dự án (ví dụ
> `jest --coverage`, `go test -cover`, `pytest --cov`, jacoco) vào script test/CI. Nếu dự án cần
> ngưỡng khác, sửa con số ngay tại article này khi đưa vào `.specify/memory/constitution.md`.
