# Báo cáo hoàn thành gói công việc Wave 4 W3: Xử lý danh sách (#109, #107)

## 1. Tóm tắt những việc đã làm

Gói công việc W3 tập trung hoàn thiện trải nghiệm chỉnh sửa danh sách trong Tiptap WYSIWYG editor cho extension VS Code, bao gồm hai vấn đề chính:

1. **Issue #109 (Sửa công thức thụt lề dòng nối tiếp trong OrderedList tokenizer)**:
   - Phát hiện nguyên nhân gốc: trong hàm `collectOrderedListItems` của `@tiptap/extension-list`, công thức tính thụt lề cho dòng nối tiếp là `contentIndent = indentLevel + marker.length + 1`. Công thức này coi độ dài ký tự phân cách là cố định 1 ký tự và bỏ qua khoảng cách phân tách, dẫn đến sai lệch thụt lề với các đánh số nhiều chữ số (như `10.`, `100.`), khiến dòng nối tiếp thiếu 1 khoảng trắng và mất ổn định qua 2 vòng roundtrip.
   - Giải pháp: tạo `CustomOrderedList` kế thừa từ `OrderedList` trong `src/webview/ordered-list-extension.ts`, ghi đè `markdownTokenizer` với công thức chuẩn xác `contentIndent = indentLevel + marker.length + separator.length + spacing.length`.
   - Đăng ký `CustomOrderedList` trong `src/webview/main.ts` và `harness/editor.ts`, tắt `orderedList` mặc định trong cấu hình `StarterKit`.
   - Cập nhật golden cho `harness/golden/synthetic/list-continuation-underindented.md` (giữ nguyên file fixture gốc theo đúng quy định).
   - Thêm fixture mới `harness/fixtures/synthetic/ordered-list-multi-digit-indent.md` và capture golden chốt chặn cho các đánh số từ 1 chữ số tới 3 chữ số (`1.`, `10.`, `100.`).
   - Tạo báo cáo lỗi chi tiết cho nhóm phát triển upstream tại `docs/upstream/tiptap-extension-list-109.md`.
   - Kết quả: kiểm tra ổn định 2 vòng đạt 0 lỗi (giảm từ 1 lỗi trước đây trên develop).

2. **Issue #107 (Bàn phím Tab/Shift-Tab, chuyển kiểu sub-list và hấp thụ marker gõ tay)**:
   - Tạo extension `ListKeymapExtension` trong `src/webview/list-keymap-extension.ts`:
     - Nhấn Tab ở mục đầu tiên của danh sách: nếu ngay trước đó là một danh sách khác, mục này sẽ được thụt vào làm mục con dưới mục cuối của danh sách trước; nếu phía trước là đoạn văn hoặc tiêu đề (hoặc đầu tài liệu), phím Tab được nuốt lại (giữ tiêu điểm trong trình soạn thảo, tuyệt đối không biến đoạn văn hay tiêu đề phía trước thành danh sách).
     - Nhấn Tab ở mục thứ hai trở đi trong danh sách có thứ tự (ordered list): chuyển thành danh sách dấu đầu dòng (bullet list) cho mục con mới (giống hành vi Notion, Google Docs); nếu đã có sẵn mục con kiểu danh sách có thứ tự thì bảo tồn kiểu danh sách đó.
     - Nhấn Shift-Tab: nâng cấp (lift) mục con trở lại cấp cha.
     - Gõ thủ công tiền tố đánh số (như `2. ` hoặc `2) `) tại đầu mục trong danh sách có thứ tự: input rule `absorbOrderedListMarkerRule` tự động hấp thụ tiền tố gõ tay, tránh việc sinh ra số thứ tự trùng lặp (ví dụ `2. 2.`).
     - Tương tác trong ô bảng (table cell): nhấn Tab ở mục thứ hai trở đi trong ô bảng sẽ thụt mục đó thành danh sách con trong phạm vi ô; nhấn Tab ở mục đầu tiên hoặc ngoài danh sách sẽ chuyển tới ô kế tiếp (và tự động thêm dòng mới khi ở ô cuối cùng của bảng).
   - Cập nhật bộ tuần tự hóa bảng `src/webview/table-markdown-serializer.ts`: bổ sung hàm đệ quy `renderListToParts` hỗ trợ tuần tự hóa đầy đủ các danh sách lồng nhau trong ô bảng qua thẻ `<br>`, ngăn ngừa mất mát dữ liệu khi lưu.
   - Đăng ký `ListKeymapExtension` vào `src/webview/main.ts` và `harness/editor.ts`.
   - Tạo seam kiểm thử chuyên biệt `harness/list-keys-seam.ts` kiểm tra 8 trường hợp và ghi nhận vào `harness/golden/seams/list-keys.txt`. Tất cả 8 trường hợp đều đạt kết quả "yes".

## 2. Kết quả các lệnh kiểm chứng

### a) `npm run lint` (TypeScript check)
```
> tui-milkdown-vscode@2.15.2 lint
> tsc --noEmit
```
Kết quả: 0 lỗi, hoàn thành sạch sẽ.

### b) `npm run build` (Production build)
```
> tui-milkdown-vscode@2.15.2 build
> node esbuild.config.js

Building (production)...
Build complete (production)
```
Kết quả: hoàn thành không có cảnh báo hay lỗi.

### c) `npm run roundtrip` (Check mode)
```
> tui-milkdown-vscode@2.15.2 roundtrip
> node esbuild.harness.config.js && node out/harness/roundtrip.js

harness built: out/harness/roundtrip.js
markdown roundtrip harness: mode: check
corpus: 38 fixtures (33 synthetic, 5 repo docs)

──────────────────────────────────────────
──────────────────────────────────────────
38 markdown fixtures + 7 seams: 45 passed, 0 failed, 0 missing, 0 errored
```
Kết quả: 45/45 passed (38 fixtures và 7 seams).

### d) Hai vòng kiểm tra ổn định (Two-round stability check)
Lệnh thực thi:
```bash
cp harness/golden/synthetic/*.md harness/fixtures/synthetic/ && npm run roundtrip; git checkout -- harness/fixtures/synthetic/
```
Đầu ra thực tế:
```
harness built: out/harness/roundtrip.js
markdown roundtrip harness: mode: check
corpus: 38 fixtures (33 synthetic, 5 repo docs)

──────────────────────────────────────────
──────────────────────────────────────────
38 markdown fixtures + 7 seams: 45 passed, 0 failed, 0 missing, 0 errored
```
Kết quả: 0 failed (đã giải quyết triệt để lỗi failed duy nhất của `list-continuation-underindented.md` trước đây trên develop).

### e) Ghi chú về `npm run verify:vscode-floor`
Theo chỉ thị trực tiếp từ điều phối viên (coordinator directive), lệnh `npm run verify:vscode-floor` không được chạy trong worker này vì script `harness/vscode-floor/run.mjs` sử dụng thư mục `/tmp/tuimd-floor` dùng chung, dễ gây xung đột khi nhiều worker chạy song song. Điều phối viên sẽ thực thi kiểm tra vscode-floor tuần tự khi tích hợp nhánh.

## 3. Chi tiết nguyên nhân gốc và cách xử lý Issue #109

### Hiện tượng
Trước khi sửa, vòng kiểm tra ổn định thứ hai trên nhánh develop luôn báo 1 thất bại tại fixture `harness/fixtures/synthetic/list-continuation-underindented.md`.

### Cơ chế và nguyên nhân
1. Khi Marked phân tích cú pháp Markdown, dòng nối tiếp được gộp vào item của danh sách có thứ tự.
2. Khi Tiptap tuần tự hóa tài liệu trở lại Markdown, hàm `collectOrderedListItems` trong `@tiptap/extension-list` tính toán độ rộng thụt lề bằng:
   ```ts
   const contentIndent = indentLevel + marker.length + 1
   ```
3. Giả sử item là `10. text`, độ dài marker là 2 (`10`), ký tự phân cách là 1 (`.`), khoảng cách là 1 space. Tổng khoảng cách thụt lề thực tế của nội dung sau marker phải là `2 + 1 + 1 = 4`. Tuy nhiên công thức upstream chỉ tính `2 + 1 = 3`.
4. Vì vậy, ở lần lưu thứ nhất, dòng nối tiếp chỉ được thụt 3 khoảng trắng thay vì 4. Ở lần lưu thứ hai, trình phân tích CommonMark thấy dòng nối tiếp thiếu thụt lề so với cột nội dung của item `10.`, dẫn tới việc khoảng trắng bị cắt tiếp hoặc bị tách khối.

### Cách xử lý
Tạo `CustomOrderedList` trong `src/webview/ordered-list-extension.ts` sửa công thức thành:
```ts
const contentIndent = indentLevel + marker.length + separator.length + spacing.length
```
Công thức này phản ánh chính xác vị trí bắt đầu của nội dung cho mọi loại marker, từ 1 chữ số tới nhiều chữ số, giúp đạt trạng thái bất động ngay từ vòng lưu đầu tiên.

## 4. Chi tiết tính năng và cơ chế thực thi Issue #107

### Hành vi phím Tab ở mục đầu tiên
- Nếu mục danh sách là mục đầu tiên và đứng ngay sau một danh sách khác (ví dụ `1. a` theo sau bởi `- b`), nhấn Tab sẽ ngắt item đó khỏi danh sách hiện tại và chèn nó vào làm item con của item cuối cùng trong danh sách đứng trước (`1. a\n   - b`).
- Nếu mục danh sách là mục đầu tiên nhưng đứng sau một đoạn văn, tiêu đề hoặc ở đầu văn bản, nhấn Tab sẽ bị nuốt lại (`return true`), giữ tiêu điểm trong trình soạn thảo, không thực hiện chuyển đổi đoạn văn hoặc tiêu đề phía trước thành danh sách.

### Hành vi chuyển đổi kiểu sub-list
- Khi người dùng nhấn Tab ở mục thứ hai trở đi trong danh sách có thứ tự (ordered list): nếu mục đó chưa có danh sách con, extension sẽ chủ động tạo một `bulletList` cho cấp con mới. Hành vi này mang lại trải nghiệm mượt mà, trực quan theo chuẩn của các trình soạn thảo hiện đại (Notion, Google Docs).
- Nếu mục phía trước đã có sẵn danh sách con kiểu `orderedList`, extension sẽ tôn trọng cấu trúc có sẵn và giữ nguyên kiểu `orderedList`.

### Hấp thụ marker gõ tay (Input Rule)
- Khi người dùng đang ở trong một mục của danh sách có thứ tự và tiếp tục gõ thủ công `2. ` hoặc `2) `, quy tắc nhập liệu `absorbOrderedListMarkerRule` phát hiện mẫu regex `/^(\d{1,9}[.)]\s)$/` và kiểm tra xem vị trí hiện tại có nằm trong `orderedList` hay không. Nếu có, rule sẽ xóa chuỗi ký tự vừa gõ để tránh tạo ra marker kép như `2. 2. content`.

### Điều hướng và thụt lề trong ô bảng (Table Cells)
- Nếu con trỏ đang ở trong ô bảng và ở mục thứ hai trở đi của một danh sách, nhấn Tab sẽ thụt lề mục đó trong phạm vi ô bảng.
- Nếu con trỏ ở mục đầu tiên hoặc không nằm trong danh sách, nhấn Tab sẽ chuyển sang ô kế tiếp thông qua `goToNextTableCell`. Nếu đang ở ô cuối cùng của bảng, extension tự động gọi `addRowAfter` để thêm dòng mới.
- Hỗ trợ đệ quy trong `table-markdown-serializer.ts`: khi một danh sách trong ô bảng được thụt lề thành danh sách con, hàm `renderListToParts` duyệt qua các cấp lồng nhau và tuần tự hóa từng mục ngăn cách bởi `<br>`, bảo đảm dữ liệu không bị mất mát.

## 5. Phân loại các thay đổi trong Golden

- `harness/golden/synthetic/list-continuation-underindented.md`: Phân loại sửa lỗi đúng (intended fix). Trước đây golden lưu dữ liệu bị thiếu khoảng trắng do lỗi upstream; nay đã phản ánh đúng chuẩn thụt lề CommonMark và đạt điểm bất động hoàn toàn.
- `harness/golden/synthetic/ordered-list-multi-digit-indent.md`: Phân loại bổ sung dự kiến (intended addition). Fixture mới kiểm tra và bảo đảm thụt lề chính xác cho các danh sách có đánh số từ 1 đến 3 chữ số.
- `harness/golden/seams/list-keys.txt`: Phân loại bổ sung dự kiến (intended addition). Baseline golden cho seam kiểm thử 8 kịch bản của phím Tab/Shift-Tab và input rule danh sách.

## 6. Đề xuất cập nhật tài liệu dự án

Theo quy định, worker không chỉnh sửa trực tiếp các tệp markdown ở thư mục gốc (`AGENTS.md`, `CHANGELOG.md`, `README.md`). Dưới đây là nội dung đề xuất để người phụ trách tích hợp cập nhật:

### Đề xuất thêm vào `CHANGELOG.md`:
```markdown
### Fixed
- Fixed ordered list continuation line indentation formula in tokenizer so multi-digit markers do not under-indent and lose spaces on roundtrip (#109)
- Fixed nested list serialization inside table cells so sunk sub-lists are preserved across roundtrips

### Added
- Added custom list keymap for Tab/Shift-Tab navigation: nesting first item under preceding list, converting ordered sub-lists to bullets, swallowing Tab on first item with no preceding list, and supporting table cell list indentation (#107)
- Added input rule absorbing manual ordered list markers typed at the start of ordered list items (#107)
```

### Đề xuất cập nhật `AGENTS.md` (mục File Structure):
```markdown
│   ├── ordered-list-extension.ts # Custom OrderedList extension correcting continuation line indent (#109)
│   ├── list-keymap-extension.ts  # List keymap (Tab/Shift-Tab) and manual marker absorption rule (#107)
```
và trong mục `harness/`:
```markdown
├── list-keys-seam.ts               # Tab/Shift-Tab and input rule navigation seam (#107)
```
