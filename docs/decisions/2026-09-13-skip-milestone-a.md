# Bỏ qua Mốc A, đi thẳng tiếp

- **Ngày:** 2026-09-13
- **Trạng thái:** PM quyết
- **Ảnh hưởng:** `SPEC.md` §14.3

## Vấn đề

§14.3 đặt Mốc A sau P4 với điều kiện đi tiếp: _"Lịch engine tính ra PM tin được"_, và nói rõ
_"Không đạt Mốc A thì dừng"_.

Tôi đã dừng lại và đề nghị PM duyệt, vì đó không phải thứ test tự trả lời được.

## Quyết định

**PM chọn bỏ qua Mốc A** và tiếp tục các phase sau.

## Hệ quả cần ghi nhớ

Mốc A tồn tại để giảm thiểu rủi ro `R3` của §15 — _"Làm dở dang rồi bỏ"_ — bằng cách dừng
sớm nếu engine sai. Bỏ qua nó nghĩa là:

- Các phase sau (P6 trở đi) được xây **trên một engine chưa ai đối chiếu với phán đoán nghề
  nghiệp**. Test chứng minh engine tái lập được và đúng công thức spec; nó không chứng minh
  lịch hợp lý với một PM thật.
- Nếu về sau phát hiện mô hình lập lịch sai ở tầng khái niệm, khối lượng phải làm lại sẽ lớn
  hơn nhiều so với dừng ở P4.

Đây không phải phản đối — quyết định phạm vi là của PM. Ghi lại để nếu tình huống đó xảy ra,
không ai phải đi tìm xem đã bỏ qua ở đâu.

## Vẫn nên làm khi thuận tiện

Đường ống đã chạy được từ DB tới DB, nên đã có lịch hoàn chỉnh để nhìn. Chỉ cần PM xem một
lần trên dữ liệu thật là đóng được rủi ro này, không cần dừng cả dự án.
