# Lớp test component cho web

**Ngày:** 2026-09-14
**Trạng thái:** Đã làm. PM đồng ý thêm dependency.

## Vì sao cần

`packages/web` chỉ có test cho `model/` — hàm thuần. Không có gì kiểm component, và đúng
lỗ hổng đó đã để lọt **hai bug ở S7**, cùng một kiểu:

> `useState(prop)` chỉ đọc giá trị khởi tạo **một lần**. Dữ liệu tới sau (nó là một truy
> vấn riêng) thì ô nhập vẫn giữ giá trị cũ.

Hậu quả thật: đổi sang dự án khác mà ô ngày vẫn là `status_date` của dự án trước, và ô tên
vẫn đề tên baseline của dự án trước. Bấm _Close period_ là chốt một mốc với **ngày sai và
tên sai** — cả hai trông hoàn toàn bình thường trên màn hình.

Từ đó tới giờ, mọi màn mới (S2, S5, S9) đều chỉ được kiểm bằng tay trên trình duyệt. Cách
đó tìm được lỗi thật — nó đã tìm ra ba lỗi trong phiên này — nhưng nó không chạy lại được
ở CI, nên không giữ được gì.

## Dependency đã thêm

|                               |                                                   |
| ----------------------------- | ------------------------------------------------- |
| `@testing-library/react`      | dựng và tra cây theo vai trò, không theo class    |
| `@testing-library/user-event` | gõ / bấm như người thật, không phải bắn event thô |
| `jsdom`                       | môi trường DOM cho vitest                         |

Ba gói, đều `devDependencies` của riêng `packages/web`. `npm audit` không thêm cảnh báo
mới nào (hai cảnh báo `moderate` đang có là của `exceljs`, có từ trước).

## Cấu hình

Project `web` trong `vitest.config.ts` chuyển sang `environment: 'jsdom'` và thêm
`@vitejs/plugin-react` để biên dịch JSX. `tests/setup.ts` gọi `cleanup` sau mỗi test —
thiếu nó thì test sau nhìn thấy cây của test trước, và `getByRole` trả về phần tử của một
màn hình đã đóng. Kiểu hỏng đó thường vẫn XANH, chỉ sai khi thứ tự test đổi.

`components/**` **cố ý KHÔNG** nằm trong ngưỡng coverage. Thêm vào thì coverage toàn cục
tụt xuống 78% ngay, vì phạm vi đó gồm cả những màn chưa có test component nào (WBS tree,
Gantt, Import, các panel). Đạt 80% trên toàn bộ chúng là một khối việc riêng và là quyết
định của PM, không phải hệ quả phụ của việc dựng lớp test. Test vẫn chạy và vẫn chặn hồi
quy — chỉ là không bị đo chung ngưỡng với engine, nơi M2 đòi đúng tuyệt đối.

Tôi đã thử thêm vào và CI đỏ đúng vì lý do này.

## Đã khoá lại những gì

**29 test**, tập trung vào thứ đã hỏng thật chứ không phải vào việc đạt con số:

- **S7** — ba mặt của mẫu "bản nháp thắng dữ liệu suy ra": dữ liệu tới muộn phải cập nhật
  ô; đổi dự án phải đổi theo; nhưng chữ PM đang gõ thì **không** được giẫm lên.
- **S2** — cùng mẫu đó, cộng: thiếu `onSave` thì chỉ đọc (§10.6, lead xem được không sửa
  được); xoá trắng ô phải gửi `null` chứ không phải chuỗi rỗng.
- **S9** — lọc "chỉ quá tải", chú giải thứ tự ưu tiên (§7.12), và luôn hiện **con số** chứ
  không chỉ màu (màu một mình không đọc được với người mù màu).

## Kiểm rằng chúng thật sự bắt được

Tạm phá code, đúng những lỗi đã xảy ra:

| Phá gì                                                           | Kết quả  |
| ---------------------------------------------------------------- | -------- |
| S7: `useState(null)` → `useState(statusDate)` (đúng bug lịch sử) | **2 đỏ** |
| S2: bỏ mẫu bản nháp (`draft ?? saved` → `saved`)                 | **3 đỏ** |

Trước khi sửa lại lint/typecheck thì bản đầu bắt được **3** ca S7; sau khi gộp hai ca gần
nhau còn 2 — vẫn phủ cả ba tình huống.

## Một điều đáng ghi về quy trình

`vitest` **transpile chứ không typecheck**, nên test có thể xanh trong khi `tsc` đỏ. Đã
gặp đúng chuyện đó hai lần trong ngày (một lần làm CI đỏ ở PR #53).

**`npm test` một mình không đủ. Phải chạy `npm run typecheck` và `npm run lint` nữa** —
đó là ba cổng khác nhau, không phải ba cách gọi cùng một cổng.
