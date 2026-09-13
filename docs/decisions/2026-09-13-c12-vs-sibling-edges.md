# `C12` cấm đúng thứ §6.3 cho phép

- **Ngày:** 2026-09-13
- **Trạng thái:** đã xử lý trong code, **PM nên xác nhận**
- **Ảnh hưởng:** `SPEC.md` §6.3, §8.1 `C12`, §8.3 `N08`

## Vấn đề

Phát hiện khi dựng fixture cho `CLAUDE.md` §4 (task bị huỷ giữa chuỗi). Hai điều khoản
mâu thuẫn:

> §6.3 — _"Task lá **cùng cha** được phép có dependency với nhau."_
> Và: _"**Cách 2 — cạnh tường minh.** Khai báo trực tiếp giữa hai anh em, dùng cho ngoại lệ."_

> §8.1 `C12` — _"Dependency khai báo ở task có `depth > dependency_max_level`."_ (Critical)

Task lá **luôn** sâu hơn `dependency_max_level` — §6.2 chốt chính điều đó: _"Cấp 4+ | Task
lá 0.25–1 MD | ❌ kế thừa từ cha"_. Nên `C12` hiểu theo nghĩa đen sẽ chặn **mọi** cạnh
tường minh giữa hai anh em, và "Cách 2" của §6.3 trở thành điều khoản không bao giờ
dùng được.

Không phải trường hợp hiếm: bất kỳ dữ liệu thật nào dùng "Cách 2" đều bị chặn ở bước
validate, trước cả khi tới scheduler.

## Quyết định đã cài

`C12` **miễn trừ cặp cùng cha**. Cạnh sâu mà **khác cha** vẫn là `C12`.

Lý do tách như vậy: §6.2 đặt giới hạn cấp khai báo để scheduler xếp lịch **theo cụm** —
_"Đồ thị nhỏ đi hàng chục lần"_. Cạnh giữa hai anh em nằm **trong** một cụm nên không phá
gì; cạnh vượt ra ngoài cụm mới phá.

Cách này cũng khớp với §8.3 `N08` (_"Task lá trỏ dependency sang task lá khác cha"_,
Minor): spec đã coi cạnh lá-khác-cha là chuyện đáng nói riêng, nên nó không thể đồng thời
là thứ `C12` vốn nhắm tới.

## Cần PM xác nhận

Cách đọc trên là suy luận của tôi từ ý đồ §6.2, không phải chữ trong spec. Hai chỗ nên
sửa cho khỏi mơ hồ:

- **§8.1 `C12`** — thêm _"trừ cạnh giữa hai task lá cùng cha (§6.3 Cách 2)"_.
- **§8.3 `N08`** — làm rõ quan hệ với `C12`: cạnh lá-khác-cha hiện dính cả hai, và mức
  Critical của `C12` sẽ nuốt mức Minor của `N08`.

Nếu PM muốn nghĩa đen của `C12` thay vì cách đọc này, thì phải bỏ "Cách 2" khỏi §6.3 —
không giữ được cả hai.
