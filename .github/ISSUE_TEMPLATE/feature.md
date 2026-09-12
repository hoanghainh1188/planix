---
name: Feature
about: Khởi tạo 1 feature mới — số issue này sẽ là ID feature (branch NNN-<slug>)
title: "[feature] <slug ngắn gọn>"
labels: feature
---

<!--
Số issue này = FEATURE ID. Sau khi tạo, branch làm feature đặt tên:
    <NNN>-<slug>    với NNN = số issue zero-pad tối thiểu 3 chữ số
    VD issue #42 → branch 042-user-reservation
Xem docs/TEAM-WORKFLOW.md.
-->

## Slug đề xuất
<!-- kebab-case, ngắn, tra docs/00-glossary.md cho nhất quán nghiệp vụ. VD: user-reservation
     → branch 042-user-reservation; thư mục design docs/01-03/user-reservation/ (cùng slug). -->

## Tài liệu design nguồn
- Basic design (基本設計): `docs/01-basic-design/<slug>/...`
- Detail design (詳細設計): `docs/02-detail-design/<slug>/...`
- Figma (link + node): `docs/03-ui/<slug>/figma-links.md`
  (`<slug>` = phần sau `NNN-` trên branch — khớp `src/features/<slug>/` và intake.)

## Owner / Assignee
<!-- Ai sở hữu feature này END-TO-END (1 người, xem TEAM-WORKFLOW mục 3). Gán luôn GitHub Assignee
     cho đúng người này để cả team biết ai đang cầm feature. -->

## Claim feature (sau khi tạo branch)
<!-- Ngay sau `git checkout -b NNN-<slug>`:
     1. Xác nhận Assignee = owner ở trên
     2. Gắn label in-progress lên issue này (tạo label một lần trong repo nếu chưa có)
     Gỡ label in-progress khi PR merge / issue đóng. -->

## Blocked by
<!-- Liệt kê issue phải xong TRƯỚC (VD "#12 auth module"). Để trống nếu độc lập.
     Giúp xếp thứ tự merge, giảm rebase/conflict chồng chéo. -->

## Affected domains / shared surface
<!-- Feature này chạm domain/module nào? Có đụng vùng DÙNG CHUNG không?
     (src/shared/, config, router, docs/00-glossary.md, constitution…)
     Càng nhiều feature cùng chạm 1 surface → càng dễ conflict/drift (TEAM-WORKFLOW mục 4–5).
     VD: "domain 予約; append glossary; KHÔNG đụng src/shared". -->

## Tóm tắt acceptance
<!-- Chức năng làm gì, cho ai, tiêu chí "xong" chính -->

## Ghi chú
<!-- Ràng buộc từ khách? Mâu thuẫn đã thấy trong tài liệu? -->
