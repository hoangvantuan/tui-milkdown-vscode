# Kết quả bản kiểm tay

Ngày: 2026-09-19  ·  Phiên bản: 2.17.0  ·  VS Code: 1.138.0

Sinh bởi `scripts/manual-checks.sh`. Tiêu chí và lý do từng mục nằm ở
`docs/manual-checks.md`.

| Mục | Kết quả | Ghi chú |
| --- | --- | --- |
| A1B | pass |  |
| A2 | pass |  |
| A3B | pass |  |
| B1 | pass |  |
| B2 | fail |  |
| C1 | skip | copy ảnh vẫn dược |
| C2 | pass |  |
| C3 | fail | ảnh bị thành https://file%2B.vscode-resource.vscode-cdn.net/var/folders/gm/yd70r3cs6ps997wrhs_nw0g80000gn/T/tui-manual-checks/images/image-1789817676245-qcyuquw.png |
| C4B | pass | có vào thùng rác |
| E1B | pass |  |
| F1 | pass |  |
| G1 | skip | dầu # ở đầu hiển thị headling để copy không cần, tự dưng bị lệch 1 đoạn xấu bỏ đi |
| X1 | skip |  |
| X2 | fail | chọn image qua command không hoạt động ![]()sdkjfshdg |

Mục nào `fail` thì mở issue mới, dán đúng dòng quan sát được.
Mục nào `skip` thì vẫn là nợ, không phải là xong.
