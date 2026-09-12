# CI dùng GitHub Actions, không phải GitLab CI

- **Ngày:** 2026-09-12
- **Trạng thái:** đã chốt, chờ PM sửa `SPEC.md`
- **Ảnh hưởng:** `SPEC.md` §3.2, §14.2 / P11

## Vấn đề

`SPEC.md` §3.2 ghi _"Deploy qua GitLab CI: build image → push → `docker compose up -d`"_,
và tiêu chí nghiệm thu P11 ghi _"GitLab CI: build → push → deploy"_.

Nhưng repo nằm ở `github.com/hoanghainh1188/planix`. Hai chỗ này mâu thuẫn nhau.

## Quyết định

Dùng **GitHub Actions**.

## Lý do

- Repo đã ở GitHub, không có kế hoạch chuyển sang GitLab.
- Gác cổng CODEOWNERS + branch protection mà `CLAUDE.md` §7 dựa vào ("Không tự merge.
  PM review") là cơ chế của GitHub. Tách CI sang GitLab sẽ làm cổng review và cổng CI
  nằm ở hai nơi, dễ có trạng thái merge được mà CI chưa xanh.
- Phần deploy ở P11 (build image → push registry → `docker compose up -d`) không phụ
  thuộc nhà cung cấp CI. Chuyển tả sang Actions là việc cơ học.

## Việc phải làm

- [ ] PM sửa `SPEC.md` §3.2: "Deploy qua GitLab CI" → "Deploy qua GitHub Actions".
- [ ] PM sửa `SPEC.md` §14.2 / P11, dòng cuối: "GitLab CI" → "GitHub Actions".
- [x] `.github/workflows/ci.yml` — typecheck, lint, test + golden, coverage.
- [ ] P11: thêm job build image + deploy.

## Ghi chú

Ngưỡng hiệu năng §7.14 và §14.2 được đo trên VPS 2 vCPU / 4 GB. Runner dùng chung của
GitHub không phải mốc tham chiếu hợp lệ, nên job `bench` trong CI để `continue-on-error`
và chỉ dùng để thấy xu hướng. Nghiệm thu hiệu năng thật chạy thủ công trên VPS trước khi
đóng phase có ngưỡng (P1, P2, P4).
