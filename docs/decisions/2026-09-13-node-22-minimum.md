# Node tối thiểu là 22, không phải 20

- **Ngày:** 2026-09-13
- **Trạng thái:** đã hoàn tất
- **Ảnh hưởng:** `SPEC.md` §3.1

## Vấn đề

`SPEC.md` §3.1 ghi stack là _"TypeScript, Node 20+"_.

Nhưng cũng chính §3.1 chốt store là `better-sqlite3`, và bản hiện tại (13.0.3) khai
`engines: { node: ">=22" }`. Hai dòng trong cùng một bảng mâu thuẫn nhau.

Triệu chứng không hề nói ra điều đó: CI chạy Node 20 báo **SIGSEGV** ở cả ba file test
đụng DB, ngay lúc "started state". Không có thông báo nào nhắc tới phiên bản Node —
chỉ là worker chết. Máy dev chạy Node 24 nên bốn cổng đều xanh.

## Quyết định

Node tối thiểu là **22**. CI chạy Node 22, `package.json` khai `engines: >=22`.

## Vì sao chạy CI trên 22 chứ không 24

22 là sàn. Máy dev đang dùng 24, nên trên thực tế cả hai đều được chạy qua. Test ở sàn
bắt được đúng loại lỗi "chạy tốt trên máy tôi" mà lần này đã xảy ra.

Đã cân nhắc matrix `[22, 24]` và **bỏ**: matrix đổi tên check thành `verify (22)` và
`verify (24)`, trong khi branch protection của `main` đang bắt buộc check tên `verify`.
Check đó sẽ không bao giờ báo và mọi PR bị chặn vĩnh viễn. Muốn dùng matrix thì phải
thêm một job tổng hợp tên `verify` phụ thuộc matrix, rồi đổi required check — việc đó
để sau, khi có lý do thật cần nhiều phiên bản.

## Việc phải làm

- [x] `.github/workflows/ci.yml` — `node-version: 22`
- [x] `package.json` — `engines.node: ">=22"`
- [x] PM sửa `SPEC.md` §3.1: "Node 20+" thành "Node 22+"
- [ ] P11: Dockerfile dùng base image Node 22 trở lên

## Ghi chú

Nâng `better-sqlite3` về sau phải kiểm lại `engines` của nó. Ràng buộc phiên bản Node
đến từ thư viện native, không phải từ lựa chọn của dự án.
