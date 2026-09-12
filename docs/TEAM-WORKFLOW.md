# Quy trình làm việc nhóm

Tài liệu này mô tả cách **nhiều người cùng làm 1 dự án** dựng từ template này mà **không gây git
conflict** và **không lệch ngữ cảnh** (glossary, constitution, design gốc). Đọc kèm `CLAUDE.md`
(quy ước bắt buộc) và `README.md` (workflow 1 feature).

> ⚠️ **Setup load-bearing — làm 2 việc này TRƯỚC khi team bắt đầu.** Chưa làm thì mọi cơ chế gác cổng
> bên dưới **âm thầm vô hiệu** (GitHub không ép steward duyệt, ai cũng merge thẳng vào `main`):
> 1. **`.github/CODEOWNERS`** — thay `@your-lead-handle` bằng GitHub handle thật của (các) steward.
> 2. **Branch protection cho `main`** — bật *Require PR* + *Require review from Code Owners* +
>    *Require status checks* (`template-smoke-test`) + *Require branches up to date*. Chi tiết ở [mục 9](#9-điểm-nóng-conflict--branch-protection).

---

## 1. Repo & branch model

- **1 repo chung**, nhánh mặc định `main` luôn xanh (CI pass, deploy được).
- Mỗi feature = **1 branch ngắn hạn** tách từ `main`, merge lại qua **Pull Request**.
- Merge vào `main` chỉ khi: **CI xanh** + **review pass** (code-owner nếu đụng file gác cổng).
- **Ưu tiên branch sống ngắn** (gộp trong vài ngày). Branch càng sống lâu, càng dễ lệch ngữ cảnh
  so với glossary/constitution mới trên `main`.

---

## 2. Quy ước đánh số feature — dùng số issue GitHub

Đây là chốt chặn chính chống **trùng ID feature** khi nhiều người tạo branch song song.

1. **Mọi feature bắt đầu bằng 1 GitHub issue** (dùng `Feature` issue template). **Số issue = feature ID.**
2. **Branch**: `NNN-<slug>` với `NNN` = số issue **zero-pad tối thiểu 3 chữ số**.
   - VD: issue `#42` → `042-user-reservation`; issue `#2342` → `2342-workflow-cli`.
   - Spec Kit validate branch sequential yêu cầu tiền tố **≥ 3 chữ số**, nên số nhỏ phải zero-pad.
   - Số issue là duy nhất toàn cục → **không bao giờ trùng** giữa các thành viên.
3. **Đánh số thư mục `specs/` = `timestamp` (bootstrap đã cấu hình sẵn — không cần làm gì thêm).**
   `bootstrap.sh` đặt `"feature_numbering": "timestamp"` trong `.specify/init-options.json`, nên
   `/speckit-specify` sinh thư mục `specs/<YYYYMMDD-HHMMSS>-<slug>` — **duy nhất toàn cục, không quét
   `specs/`**. Đã kiểm chứng qua tài liệu Spec Kit: base `/speckit-specify` dựng tên thư mục theo
   `feature_numbering` (quét `specs/` khi `sequential`, dùng timestamp khi `timestamp`), **không** suy
   từ tên branch — nên timestamp là cách chống trùng đáng tin nhất khi chạy song song.

**Hai lớp số — KHÔNG cần khớp nhau:**

| Lớp | Giá trị | Vai trò |
|---|---|---|
| Tên **branch** | `NNN-<slug>` (NNN = số issue) | PR / `Closes #` / traceability con người |
| Thư mục **`specs/`** | `<YYYYMMDD-HHMMSS>-<slug>` (timestamp) | Nội bộ Spec Kit, chống trùng song song |

Traceability đi qua **branch + số issue + `docs/intake` + `docs/04-decisions`**, KHÔNG qua tiền tố
`specs/`. Nếu team thực sự muốn thư mục `specs/` mang số issue: đổi `feature_numbering` → `sequential`
và tự quản (chấp nhận rủi ro trùng khi song song), hoặc dùng override số của Spec Kit git-extension.
Đây là lựa chọn có đánh đổi — **mặc định timestamp an toàn hơn cho nhóm.**

> **`000-` là feature MẪU, không phải số issue.** Các file `…/000-example-reservation…` kèm template
> chỉ để minh hoạ traceability — `000` **không** ứng với issue `#0`. Xoá feature mẫu trước khi làm
> thật (xem `README.md` mục "Feature mẫu"); feature đầu tiên của bạn bắt đầu từ **số issue thật**
> (VD issue `#1` → `001-<slug>`).

> Gợi ý: giữ `slug` kebab-case, ngắn gọn, tra `docs/00-glossary.md` để đặt tên nhất quán nghiệp vụ.
> Dùng **cùng `<slug>`** xuyên suốt: branch `NNN-<slug>`, thư mục design `docs/01-03/<slug>/`,
> intake `docs/intake/<NNN>-<slug>.md`, code `src/features/<slug>/` — một slug, dò dấu vết dễ.
> (`<slug>` = phần sau `NNN-` trên branch; VD `042-user-reservation` → `user-reservation`.)

---

## 3. Vòng đời 1 feature (nhóm)

```
1. Tạo GitHub issue (Feature template)         → có số issue = ID; gán Assignee
2. git checkout main && git pull               → nền mới nhất
3. git checkout -b NNN-<slug>                   (NNN = số issue, zero-pad ≥3)
   → gán label in-progress trên issue (claim — cả team biết feature đang active)
4. Đặt tài liệu vào docs/01-basic-design/<slug>/, 02-detail-design/<slug>/, 03-ui/<slug>/
   (<slug> = phần sau NNN- trên branch — khớp intake + src/features/)
5. /design-to-code                              → intake → speckit → implement → review → test
6. Mở PR "Closes #<issue>"                      (điền PR template)
7. code-reviewer + glossary-steward + security-reviewer + human review; sửa Blocking
8. Test gate: xanh + coverage ≥ ngưỡng constitution (Article W, mặc định 80%)
9. CI xanh + review pass → merge vào main       → tự đóng issue; gỡ label in-progress
```

**Claim feature:** sau bước 3, issue phải có **Assignee** (owner) + label **`in-progress`**. Tạo label
`in-progress` một lần trong repo nếu chưa có. Steward/lead: nếu 2 issue `in-progress` cùng **Affected
domains / shared surface** (xem issue template) → xếp thứ tự merge hoặc ghi `Blocked by` trước khi cả
hai chạm `src/shared/` hoặc glossary.

**Một người sở hữu 1 feature end-to-end.** Pipeline `/design-to-code` không có điểm bàn giao giữa
chừng — chuyển tay giữa dòng dễ mất ngữ cảnh intake. Nếu **buộc** phải chuyển tay, chỉ chuyển qua
**Handoff checklist** trong [`docs/intake/README.md`](intake/README.md) (ghi rõ đang ở bước nào của
pipeline, quyết định nào đã chốt, việc còn lại) — người sau nạp `docs/intake/<NNN>-<slug>.md` +
checklist để tiếp tục, không hỏi lại từ đầu.

---

## 4. Cô lập code theo feature (`src/`)

Cô lập vật lý là tuyến phòng thủ **git conflict** rẻ nhất: 2 người sửa 2 file khác nhau thì không
bao giờ đụng nhau.

- **Code riêng của feature** → `src/features/<slug>/` (`<slug>` = slug của branch `NNN-<slug>`).
  Mỗi feature một thư mục → song song hầu như không chạm cùng file.
- **Vùng dùng chung** (`src/shared/`, config gốc, router/route table, DI container, migration
  index, i18n bundle…) là **điểm nóng đụng độ**. Khi buộc phải sửa:
  - Tách thành **commit nhỏ, mục tiêu hẹp**, merge sớm để cả team rebase.
  - Ưu tiên cơ chế **append/registry** hơn sửa 1 danh sách trung tâm (VD mỗi feature tự đăng ký
    route trong file của mình thay vì cùng edit 1 mảng `routes[]`).
  - Nếu là file cấu hình chung có blast-radius lớn → cân nhắc gác cổng như glossary ([mục 7](#7-gác-cổng-glossary--constitution)).

---

## 5. Team conflict strategy

Hai loại "đụng độ" **hoàn toàn khác nhau**, cần cơ chế khác nhau — nhầm lẫn là gốc của phần lớn rắc rối:

| | **Git conflict** (cú pháp) | **Context drift** (ngữ nghĩa) |
|---|---|---|
| Là gì | 2 branch sửa **cùng dòng/cùng file** | 2 branch dựa trên **glossary/constitution/design khác phiên bản** |
| Ai phát hiện | Git (khi merge/rebase) — **ồn ào, không bỏ sót** | **Không ai** tự động — code vẫn merge sạch nhưng dùng sai term / vi phạm rule mới |
| Hậu quả | Kẹt merge, sửa tay 5 phút | Bug ngữ nghĩa lọt vào `main`, phát hiện muộn, đắt |
| Chặn bằng | Cô lập file ([mục 4](#4-cô-lập-code-theo-feature-src)) + branch ngắn + merge sớm | Rebase thường xuyên + `/speckit-analyze` lại + gác cổng glossary/constitution |

### Sơ đồ cô lập (mỗi feature là 1 làn riêng)

```
GitHub issue #NNN
      │
      ▼
branch  NNN-<slug>                         ← ID toàn cục, không trùng (mục 2)
      │
      ├─ docs/01-03/<slug>/                 ← design gốc (1 thư mục/feature)
      ├─ docs/intake/<NNN>-<slug>.md        ← 1 file/feature (mục 9 hotspot: Thấp)
      ├─ docs/04-decisions/<date>-<slug>.md ← 1 file/quyết định
      ├─ specs/<timestamp>-<slug>/          ← Spec Kit timestamp, không quét (mục 2)
      └─ src/features/<slug>/               ← code cô lập (mục 4)

vùng DÙNG CHUNG (đi ngang mọi làn — nơi drift + conflict sống):
      docs/00-glossary.md · .specify/memory/constitution.md · src/shared/ · config
      → gác cổng (mục 7) + rebase (mục 6)
```

### Ma trận phòng thủ

| Cơ chế | Chặn git conflict | Chặn context drift | Được **ép** bởi (enforcement) |
|---|---|---|---|
| Số issue = branch ID (mục 2) | ✅ trùng tên branch | — | Quy ước + issue template |
| `specs/` timestamp (mục 2) | ✅ trùng thư mục | — | `bootstrap.sh` cấu hình sẵn |
| Cô lập `src/features/<slug>/` (mục 4) | ✅ đụng file code | — | Quy ước + review |
| Branch ngắn + merge sớm | ✅ giảm cửa sổ đụng | ✅ giảm cửa sổ lệch | Kỷ luật team |
| Rebase `main` hằng ngày (mục 6) | ✅ đụng sớm, dễ gỡ | ✅ hút glossary/constitution mới | *Require branches up to date* (branch protection) |
| Chạy lại `/speckit-analyze` (mục 6) | — | ✅ bắt code/spec lệch rule/term mới | Runbook `/design-to-code` bước 8 |
| Gác cổng glossary/constitution (mục 7) | — | ✅ chặn đổi nghĩa lung tung | **CODEOWNERS + branch protection** (setup load-bearing) |
| `glossary-steward` (pipeline) | — | ✅ bắt term lệch trước merge | Runbook `/design-to-code` bước 11 |

> Cột "enforcement" phân biệt **thật sự bị chặn** (CI/branch-protection) với **chỉ dựa vào kỷ luật**.
> Càng nhiều hàng ở nhóm sau, càng phụ thuộc con người nhớ — đó là lý do 2 việc setup ở đầu tài liệu
> là *load-bearing*.

### Playbook hằng ngày

**Trước khi bắt đầu / sáng mỗi ngày:**
```
git checkout main && git pull            # nền mới nhất
git checkout NNN-<slug> && git rebase main   # hút glossary/constitution/shared mới
# nếu main vừa đổi glossary HOẶC constitution:
#   → chạy lại /speckit-analyze để bắt code/spec đã lệch rule/term mới
```

**Trong lúc dev:**
- Giữ code trong `src/features/<slug>/`; đụng `src/shared`/config → commit nhỏ, merge sớm.
- Gặp term nghiệp vụ mới → **append 1 dòng** vào `docs/00-glossary.md` ngay (rule 5) — đừng tự dịch thầm.
- Cần **sửa nghĩa** 1 term đã có / đổi constitution → **dừng, tách PR gác cổng riêng** ([mục 7](#7-gác-cổng-glossary--constitution)).

**Trước khi mở/merge PR:**
- Rebase `main` lần cuối; PR checklist đầy đủ; `glossary-steward` + (nếu cần) `security-reviewer` đã chạy.
- Nếu glossary/constitution vừa đổi trên `main` sau khi bạn implement → rebase + `/speckit-analyze` lại.

### 3 tình huống thường gặp (walkthrough)

**① 3 feature độc lập, 3 người song song** — issue #11/#12/#13 → branch `011-*` / `012-*` / `013-*`,
code trong 3 thư mục `src/features/*` khác nhau, intake/specs tách riêng. Không ai đụng ai; merge tuần
tự vào `main`, mỗi lần merge người còn lại chỉ cần `git rebase main` (thường không conflict).

**② 2 feature cùng domain** (VD cùng chạm luồng `予約`) — rủi ro **cùng sửa `src/shared` + cùng thêm
term glossary**. Cách xử: người nào chạm `src/shared` trước thì tách commit nhỏ merge sớm; người sau
rebase để hút. Term glossary mới do cả hai append (append hiếm khi đụng dòng); nếu **trùng ý nhưng
khác chữ** → `glossary-steward` ở bước 11 báo "term lệch", chọn 1 bản chuẩn, người kia sửa code theo.
Nếu cần **đổi nghĩa** term chung → 1 người mở PR glossary riêng, merge trước, cả hai rebase.

**③ Steward merge PR glossary giữa chừng** (đổi/đổi-tên 1 term khi bạn đang code) — `main` giờ có
glossary mới. Bạn: `git rebase main` → `docs/00-glossary.md` cập nhật → **chạy lại `/speckit-analyze`
+ `glossary-steward`** để lộ chỗ code/spec còn dùng term cũ → sửa → tiếp tục. Đây chính là *context
drift* mà git **không** cảnh báo giúp — nên rebase + analyze lại là bắt buộc, không phải tuỳ chọn.

---

## 6. Chống lệch ngữ cảnh (context drift)

Nguồn ngữ cảnh dùng chung: `docs/00-glossary.md`, `.specify/memory/constitution.md`, tài liệu gốc
`docs/01-03`, và `docs/04-decisions/`. Khi chạy song song, chúng dễ lệch giữa các branch.

- **Rebase `main` thường xuyên** (khuyến nghị hằng ngày) vào branch đang làm để hút glossary/constitution
  mới nhất.
- **Playbook rebase khi glossary vừa đổi trên `main`:**
  ```
  git fetch origin && git rebase origin/main
  #   nếu docs/00-glossary.md hoặc .specify/memory/constitution.md nằm trong diff vừa hút:
  git diff HEAD@{1} HEAD -- docs/00-glossary.md .specify/memory/constitution.md   # xem đổi gì
  /speckit-analyze          # (dán chạy) bắt code/spec đã lệch term/rule mới
  # → gọi lại subagent glossary-steward để soi term lệch trong src/ + specs/
  # → sửa mọi chỗ dùng term cũ, rồi mới tiếp tục / mở PR
  ```
- **Giữ feature nhỏ** → cửa sổ lệch ngắn.
- **Trước khi hỏi lại 1 ambiguity**, tra `docs/04-decisions/` (bắt đầu từ [`INDEX.md`](04-decisions/INDEX.md)) —
  có thể người khác đã quyết rồi.

---

## 7. Gác cổng glossary + constitution

`docs/00-glossary.md` và `.specify/memory/constitution.md` là **file dùng chung, tác động toàn dự án**.
Gác cổng **theo mức blast radius**, không chặn cứng mọi thứ (tránh kẹt dev giữa feature):

| Thao tác | Cách làm | Vì sao |
|---|---|---|
| **THÊM** thuật ngữ mới (append 1 dòng glossary) | Làm **ngay trong branch feature**; steward review phần glossary khi mở PR (CODEOWNERS tự kéo) | Append ít đụng nhau; chặn cứng sẽ kẹt dev đang cần đặt tên |
| **SỬA / đổi tên / xoá** thuật ngữ đã có | **PR riêng, nhỏ**, steward duyệt | Đổi nghĩa 1 term lan ra toàn codebase — rủi ro cao |
| **Mọi thay đổi** `constitution.md` | **PR riêng, nhỏ**, steward duyệt | Thắng mọi thứ trong Spec Kit — blast radius tối đa |

- PR gác cổng (SỬA glossary / constitution) merge **sớm** vào `main` để cả team rebase đồng bộ, giảm phân kỳ.
- Steward khai trong `.github/CODEOWNERS`.

> ⚠️ **CODEOWNERS chỉ là gợi ý cho tới khi bật branch protection.** Nếu chưa bật ([mục 9](#9-điểm-nóng-conflict--branch-protection)),
> GitHub **không** bắt buộc steward duyệt — cơ chế gác cổng âm thầm vô hiệu. Đây là bước setup **load-bearing**.

---

## 8. Cập nhật tài liệu gốc `docs/01-03` giữa chừng

Khi khách gửi bản design mới trong lúc đang code:

- **Không ghi đè** bản cũ. Thêm **file version mới** + cập nhật `CHANGELOG.md` trong thư mục tương ứng.
  `CHANGELOG.md` **bắt buộc** có mục **"Affected issues"** liệt kê số issue của các feature bị ảnh
  hưởng — đó là cầu nối để biết feature nào phải re-run (xem `README.md` trong `docs/01-03`).
- Mở **issue re-run** cho các feature bị ảnh hưởng → chạy lại pipeline từ `design-intake` để spec/code
  bám bản design mới, và ghi quyết định phát sinh vào `docs/04-decisions/`.

---

## 9. Điểm nóng conflict & branch protection

| File / thư mục | Rủi ro | Cách tránh |
|---|---|---|
| `.specify/memory/constitution.md` | **Cao** — 1 file chung, thắng mọi thứ | PR riêng + steward duyệt (mục 7); rebase khi đổi |
| `docs/00-glossary.md` | **Cao** — 1 bảng chung, đổi nghĩa lan toàn code | PR riêng khi SỬA + steward; THÊM thì append trong branch |
| `src/shared/`, config, router, DI | **Trung bình** — nhiều feature cùng chạm | Commit nhỏ + merge sớm + registry thay vì list trung tâm (mục 4) |
| Tên branch | Thấp | `NNN-<slug>` = số issue → duy nhất toàn cục (mục 2) |
| Thư mục `specs/<prefix>-*` | Thấp | `feature_numbering=timestamp` → không quét, không trùng (mục 2) |
| `docs/04-decisions/<date>-<slug>.md` | Thấp | Mỗi quyết định 1 file có timestamp |
| `docs/intake/<NNN>-<slug>.md` | Thấp | Mỗi feature 1 file, đặt theo số issue |
| `specs/<feature>/` | Thấp | Mỗi feature 1 thư mục, cô lập theo branch |
| `src/features/<slug>/` | Thấp | Code riêng feature, cô lập theo slug (mục 4) |

### Bật branch protection cho `main` (bắt buộc để các cơ chế trên có hiệu lực)
Settings → Branches → Add rule cho `main`:
- ☑ Require a pull request before merging
- ☑ Require approvals (≥1)
- ☑ Require review from **Code Owners**
- ☑ Require status checks to pass → chọn `template-smoke-test` (và CI dự án)
- ☑ Require branches to be up to date before merging (ép rebase → giảm drift)

---

## 10. Tóm tắt "phải nhớ"

1. **Setup load-bearing trước:** điền CODEOWNERS thật + bật branch protection — nếu không, gác cổng vô hiệu.
2. Tạo **issue trước** → số issue là **ID feature** → branch `NNN-<slug>` (zero-pad ≥3). Cùng `<slug>`
   cho `docs/01-03/`, intake + `src/features/`. Claim: Assignee + label `in-progress`.
3. **1 người sở hữu 1 feature** end-to-end; branch ngắn hạn; PR `Closes #issue`; chuyển tay chỉ qua
   Handoff checklist (`docs/intake/README.md`).
4. Sửa **glossary/constitution** → **PR riêng, steward duyệt**; rồi cả team rebase. THÊM term thì append trong branch.
5. **Rebase `main` hằng ngày**; constitution/glossary đổi → chạy lại `/speckit-analyze` + `glossary-steward` (bắt *context drift* git không thấy).
