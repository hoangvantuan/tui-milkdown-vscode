# Bản kiểm tay: những gì lưới tự động vẫn KHÔNG chạm tới

File này là **nguồn sự thật duy nhất** cho việc còn bao nhiêu tiêu chí phải kiểm bằng
tay. Tài liệu khác trỏ về đây thay vì chép lại con số, vì con số đã sai ba lần rồi.

Bản đầu liệt kê 14 mục và nói cả 14 đều cần một con người. Lượt đi kiểm thật cho thấy
điều đó sai: **năm mục lái được bằng máy và nay đã là check floor**, một mục lái được
một nửa. Quan trọng hơn, chính lượt đi kiểm ấy tìm ra **hai lỗi đang ship**, cả hai đều
không thể thấy bằng cách đọc mã:

- **DOCX export CHẾT trên đúng phiên bản VS Code mà `engines.vscode` hứa.**
  `ReferenceError: crypto is not defined`: Web Crypto chỉ thành global từ Node 19, mà
  1.85 chạy extension host trên Node 18. Ai dùng VS Code 1.85 bấm Export DOCX đều nhận
  "Export failed" và không có file. PDF không dính. Đã sửa.
- **Lightbox không bẫy được tiêu điểm trong cửa sổ không hiển thị.** Đúng cơ chế của
  `#112`, lần thứ hai: `focusOverlay()` chỉ được hẹn từ `requestAnimationFrame`, mà
  Chromium không chạy rAF cho cửa sổ bị che. Overlay mở ra, tiêu điểm nằm lại dưới
  tài liệu, Tab đi lang thang bên dưới một hộp thoại đang mở. Đã sửa.

Lấy đó làm lý do để làm nốt phần dưới.

## Trạng thái

| Mục | Tiêu chí | Ai kiểm |
| --- | --- | --- |
| A1 | Menu bảng: mở, roving focus, Escape, ba mục căn lề | **floor** `table context menu is operable from the keyboard` |
| A1b | Menu bảng: **Enter kích hoạt** một mục | **TAY** (xem A1) |
| A2 | `Ctrl/Cmd+Shift+M` hai chiều | **TAY** (floor chỉ kiểm hai lệnh có đăng ký) |
| A3 | Bubble menu ở zoom khác 100% | **floor** `bubble menu still tracks the selection at a non-100% zoom` |
| B1 | Gõ rồi đóng tab trong 300 ms | **TAY** |
| C1 | Clipboard lỗi có báo | **TAY** |
| C2 | Dán ảnh | **TAY** |
| C3 | Đổi tên ảnh | **TAY** |
| C4 | Xoá ảnh khỏi markdown thì file biến mất khi lưu | **floor** `removing an image from the markdown deletes the file on save` |
| C4b | Ảnh đó có thật sự vào **Thùng rác** không | **TAY** (floor đo được `foundIn~/.Trash=no`, xem C4) |
| D1 | Export DOCX | **floor** `export produces a real DOCX file` |
| D2 | Export PDF | **floor** `export produces a real PDF file` |
| E1 | Popup `@` và `[[` liệt kê file | **floor** `@ mention popup` / `[[ wiki link popup` |
| E1b | Chèn bằng Enter, và lời mời tạo file | **TAY** |
| F1 | `editor.tabSize` đổi thụt lề | **TAY** |
| G1 | Ảnh chụp hai theme | **TAY** |
| X1 | Git Graph diff (`#48`) | **TAY** |
| X2 | Dáng các menu | **TAY** |

**Một quan sát chưa tái hiện được.** Trong một lần chạy floor, check
`document still unmodified after the hold` báo `isDirty=true`: tài liệu tự bẩn trong 25
giây giữ, không ai gõ gì. Hai lần chạy ngay sau đó đều xanh, có và không có bước đưa
cửa sổ lên trước. Đây là vùng của `#111`. Ghi lại vì một lỗi thấy một lần vẫn là một
lỗi; nếu anh gặp lại, đó là bằng chứng thứ hai.

**Cách dùng: chạy `scripts/manual-checks.sh`.**

```bash
./scripts/manual-checks.sh
```

Nó dựng workspace test, mở VS Code với extension, rồi đi qua đúng 14 mục còn lại, mỗi
lần một mục trên màn hình sạch. Mỗi mục hỏi pass / fail / skip cộng một dòng ghi chú,
ghi vào `.manual-checks.env` nên dừng giữa chừng rồi chạy lại không mất gì, và cuối
cùng sinh `docs/manual-checks-results.md`.

Phần dưới là nội dung từng mục, để đọc khi cần hiểu vì sao một mục tồn tại. Đọc cũng
được, nhưng chạy script thì không quên mục nào và không phải tự chép bảng kết quả.

**Trước khi bắt đầu:**

```bash
npm run build                # bản production, đúng thứ người dùng chạy
npm run verify:vscode-floor  # 36 check, phải xanh hết trước khi kiểm tay
```

Rồi F5 (Extension Development Host), hoặc `npm run package` và cài file `.vsix`. Mở một
thư mục có ít nhất: một file `.md` dài hơn hai màn hình, một thư mục `images/`, và một
file `.md` thứ hai để kiểm wiki link.

Lưu ý: floor check chạy trên **VS Code 1.85**, tức là lời hứa của `engines.vscode`, chứ
không phải bản anh đang cài. Muốn chạy trên bản khác thì
`npm run verify:vscode-floor -- --version <x.y.z>`.

Ghi kết quả ở bảng cuối file.

---

## A. Bàn phím và tiêu điểm

Ba mục này chỉ cần bàn phím, làm liền một mạch được.

### A1. Menu chuột phải trên bảng dùng được bằng bàn phím (#118)

Floor check đã nhận phần lớn mục này: menu mở ra, roving focus chạy, Escape đóng, ba
mục căn lề có mặt. **Enter kích hoạt thì KHÔNG**, và lý do đáng ghi lại vì nó là giới
hạn thật của harness, không phải lười.

Lệnh căn lề đọc selection của **ProseMirror**. ProseMirror chỉ đồng bộ selection từ DOM
khi view của nó đang giữ tiêu điểm, và trong cửa sổ floor `root.focus()` không ăn:
`focusInEditor=false` ở mọi lần chạy. Đặt range bằng script không tới được ProseMirror;
mousedown tổng hợp mang đúng toạ độ ô cũng không; click qua CDP thì dùng toạ độ trang
chứ không phải toạ độ iframe. Nên dòng `enterChangedAlign=false` trong detail của check
nghĩa là **selection chưa vào bảng**, không phải Enter không chạy, và nó được BÁO chứ
không được KHẲNG ĐỊNH. Khẳng định nó là làm đỏ một tính năng đang chạy đúng, đúng cái
sai ba phiên bản trước của probe này đã mắc.

- [x] ~~Chuột phải vào một ô bảng, menu hiện ra.~~ floor
- [x] ~~Tiêu điểm chạy qua từng mục, Escape đóng.~~ floor
- [x] ~~Ba mục căn lề trái / giữa / phải có mặt.~~ floor
- [ ] **Enter trên một mục thực thi mục đó.** Đây chính là lỗi #118 đã sửa: trước đây
      menu bắt `mousedown` nên Enter không làm gì cả. Đi tới `Align Column Left` bằng
      mũi tên, Enter, và nhìn cột đổi căn lề.
- [ ] Home nhảy về mục đầu, End nhảy xuống mục cuối.
- [ ] Escape trả tiêu điểm về editor (gõ một ký tự, nó phải vào tài liệu).
- [ ] Bấm vào một `<select>` gốc của hệ thống bên trong menu (nếu có) không làm menu tự
      đóng. Đây là lý do phần đóng-khi-click-ra-ngoài cố ý vẫn giữ `mousedown`.

### A2. `Ctrl/Cmd+Shift+M` chạy từ CẢ HAI phía (#108)

- [ ] Mở Keyboard Shortcuts (`Cmd+K Cmd+S`), gõ "TUI": phải thấy **cả hai** lệnh,
      `View Source` và `View Rich Text (WYSIWYG)`, cùng gán `Ctrl/Cmd+Shift+M`.
- [ ] Đang ở editor WYSIWYG, bấm tổ hợp: chuyển sang source.
- [ ] Đang ở source, bấm tổ hợp: quay lại WYSIWYG. Đây là chiều trước đây KHÔNG có
      đường về ngoài icon trên thanh tiêu đề.

### A3. Bubble menu ở mức zoom KHÁC 100% (#116): ĐÃ TỰ ĐỘNG

Floor check `bubble menu still tracks the selection at a non-100% zoom`. Ở `zoom=1.2`:
`dx=0 dy=44`, menu vẫn gắn `#editor-container` chứ không gắn `.tiptap`.

Một bài học nằm trong chính probe này: bản đầu đo một vùng chọn nằm **cao hơn viewport
834px** rồi đọc việc floating-ui lật menu sang phía kia thành "menu trôi". So sánh với
một mốc nằm ngoài màn hình thì không đo được gì. Nay nó cuộn mốc vào tầm nhìn trước.

- [x] ~~Ở 120%: menu bám đúng vùng chọn.~~ floor
- [ ] Dưới 100% (`Cmd/Ctrl -`): vẫn đúng. Floor mới chỉ đo phía trên 100%.
- [ ] Năm nút Bold, Italic, Code, Link, Highlight tác động đúng vùng đang chọn.

---

## B. Vòng đời tab và vị trí cuộn

### B1. Gõ rồi đóng tab trong vòng 300 ms, chữ không mất (#104)

Bằng chứng cũ cho mục này là một kịch bản mô phỏng chạy NGOÀI repo và không được commit.
Trong môi trường không có layout, `scrollTop` đọc lại chính giá trị vừa gán, nên nó chỉ
chứng minh đường mã có chạy, không chứng minh gì về cuộn thật. Coi như chưa kiểm.

- [ ] Gõ 5 ký tự rồi `Cmd/Ctrl+W` ngay lập tức (dưới 300 ms, tức là gõ xong đóng luôn).
      Mở lại file. **Lặp 10 lần và ghi số lần còn đủ 5 ký tự.** ĐẠT là 10/10.
- [ ] Mở một file dài, cuộn xuống giữa, rồi sửa file đó từ một cửa sổ khác (hoặc
      `echo >> file.md` từ terminal). Vị trí cuộn KHÔNG được nhảy về đầu.

### ~~B2. Vị trí con trỏ và cuộn nhớ theo từng file (#121)~~ ĐÃ GỠ

Tính năng này đã bị gỡ khỏi 2.17 theo yêu cầu, sau chính lượt kiểm tay này. Hai lỗi
đã tìm ra và sửa trước khi gỡ, và không lỗi nào là thứ báo cáo thật sự nói tới:

- Replay được hẹn bằng `requestAnimationFrame` đơn độc, thứ không bao giờ chạy trong
  một cửa sổ đang được khôi phục lúc khởi động. Lần thứ BA cùng cơ chế `#112`.
- Nó chỉ bắn một lần, với một editor có thể chưa dựng xong.

Còn "mất trỏ" hoá ra là: **chưa bao giờ có gì focus editor trong webview này**, mà một
selection của ProseMirror trong view không giữ tiêu điểm thì không vẽ caret. Mở tài
liệu là không có con trỏ, chấm hết. Phần đó ở lại: editor nay dựng với
`autofocus: 'start'`.

Bài học đáng giữ hơn cả tính năng: **triệu chứng người dùng báo và cơ chế hỏng có thể
không dính gì tới nhau.** Sửa hai lỗi thật rồi mà người dùng vẫn thấy y như cũ.

---

## C. Ảnh

Bốn mục, cần clipboard hệ thống thật và quan sát file trên đĩa.

### C1. Clipboard lỗi thì có báo, không im lặng (#105)

- [ ] Copy một đoạn CHỮ (không phải ảnh) rồi dán vào editor: dán ra chữ, bình thường.
- [ ] Ép lỗi đọc clipboard ảnh: trên macOS đổi tên tạm `/usr/bin/osascript` là không làm
      được, nên cách thực tế hơn là copy một ảnh rồi dán khi **không có quyền** truy cập,
      hoặc copy một định dạng ảnh lạ. Cái cần thấy là **một toast lỗi**, không phải im
      lặng tuyệt đối. Trước #105 nó thất bại không kêu một tiếng.
- [ ] Nếu không ép lỗi được trong môi trường của anh, ghi thẳng "chưa ép được lỗi" vào
      bảng kết quả. Đừng ghi ĐẠT.

### C2. Dán ảnh (#88)

- [ ] Copy một ảnh vào clipboard (screenshot: `Cmd+Ctrl+Shift+4` trên macOS).
- [ ] Dán vào editor: ảnh hiện ra trong tài liệu.
- [ ] Trên đĩa có file mới trong thư mục `images/` cạnh tài liệu (theo
      `tuiMarkdown.imageSaveFolder`, mặc định `images`).
- [ ] Markdown trong source view trỏ đúng đường dẫn tương đối đó.

### C3. Đổi tên đường dẫn ảnh thì file trên đĩa đổi theo (#88)

Cần `tuiMarkdown.autoRenameImages` đang bật (mặc định bật).

- [ ] Double-click vào ảnh vừa dán, sửa tên file trong đường dẫn, lưu.
- [ ] File trên đĩa **đổi tên theo**, không phải sinh ra một file thứ hai.
- [ ] Nếu ảnh đó còn được dùng ở file `.md` khác trong workspace, tham chiếu ở file kia
      cũng được sửa.
- [ ] Đổi cả THƯ MỤC (không chỉ tên file): thao tác này cố ý bị từ chối, chỉ đổi tên
      trong cùng thư mục mới tự động.

### C4. Xoá ảnh khỏi markdown thì file vào Thùng rác (#88): MỘT NỬA ĐÃ TỰ ĐỘNG

Floor check `removing an image from the markdown deletes the file on save` dựng hai ảnh
PNG 1 pixel, lưu một lần để chúng vào `originalImagePaths`, rồi bỏ cả hai tham chiếu và
lưu lại. Nó báo:

```
baselined=true loneImageDeleted=true foundIn~/.Trash=no;
imageStillUsedByFloorOther.mdDeleted=true
```

Hai điều rút ra. Một, `#126` nay được ĐO chứ không phải đọc từ mã: tài liệu thứ hai
tham chiếu cùng ảnh không ngăn được việc xoá. Hai, file rời khỏi workspace nhưng
**không thấy trong `~/.Trash`**, nên phần "vào Thùng rác" vẫn là việc của anh, trên máy
anh. Một extension-test host không phải bằng chứng về desktop của ai cả.

Cần `tuiMarkdown.autoDeleteImages` đang bật (mặc định bật).

- [x] ~~Xoá dòng ảnh khỏi tài liệu, lưu, file biến mất.~~ floor
- [ ] File ảnh vào Thùng rác (Trash), KHÔNG bị xoá vĩnh viễn. **Floor đo được là KHÔNG
      thấy nó trong `~/.Trash`.** Đây là mục đáng kiểm nhất trong cả bản.
- [ ] Khôi phục từ Thùng rác được (đây là điểm khác nhau giữa "xoá" và "chuyển vào
      thùng rác", và là lý do thiết kế như vậy).
- [ ] Đổi ảnh sang THƯ MỤC khác (cùng tên file) rồi lưu: KHÔNG bị xoá, vì đó là thao
      tác di chuyển chứ không phải xoá.
- [ ] Ảnh còn được dùng ở file `.md` khác: hiện tại nó vẫn bị chuyển vào Thùng rác
      **không hỏi gì**, và link ở file kia gãy im lặng. Đây là hành vi đang có, không
      phải lỗi anh vừa gây ra: xem `#126`. Ghi lại quan sát thật vào bảng.

---

## D. Export

Hai mục, cần hộp thoại lưu file.

### D1. Export DOCX (#88): ĐÃ TỰ ĐỘNG, TRỪ HỘP THOẠI

Floor check `export produces a real DOCX file`. Host thay `showSaveDialog` và cái thông
báo "Open the file?" đi kèm, runner bấm đúng nút Export thật, host kiểm magic number
của thứ rơi xuống: `bytes=32242 magic=504b0304`.

Nội dung đã soi bằng `officecli view ... text`: 12 đoạn, 1 bảng 3 hàng, 2 ảnh, heading
đúng style `Heading 1`, code block đúng font Consolas. Alert `[!NOTE]` ra thành chữ
thường, task list ra thành bullet `●` không có ô tick: đó là hành vi hiện tại, không
phải lỗi mới.

**Đây là mục tìm ra lỗi nặng nhất của cả lượt kiểm.** Xem đầu file.

- [ ] Mở panel Appearance (icon bên phải thanh công cụ), chọn định dạng `DOCX`, bấm
      `Export`.
- [ ] Hộp thoại lưu file hiện ra, chọn chỗ, lưu.
- [ ] Mở file bằng Word: heading, bảng, danh sách, code block, ảnh và sơ đồ mermaid đều
      ra đúng.
- [ ] HTML thô trong tài liệu bị BỎ QUA chứ không làm hỏng file. Đây là chủ ý: DOCX
      export chạy trong Node extension host, plugin `@m2d/html` đụng vào `document` nên
      làm sập host.
- [ ] Bấm Export hai lần liên tiếp thật nhanh: lần hai bị chặn bởi khoá bận, không sinh
      ra hai tiến trình.

### D2. Export PDF (#88): ĐÃ TỰ ĐỘNG, TRỪ HỘP THOẠI

Floor check `export produces a real PDF file`: `bytes=116569 magic=25504446`. Nội dung
đã soi bằng `pdftotext`: heading, chữ đậm, link kèm URL, bảng đủ cột và giá trị, task,
code, alert, ảnh. Chromium tự dò được, không cần đặt `tuiMarkdown.chromiumPath`.

Cần một Chromium thật. `tuiMarkdown.chromiumPath` để trống thì tự dò
Chrome/Edge/Chromium/Brave.

- [ ] Chọn `PDF`, bấm `Export`, lưu.
- [ ] Mở file: nội dung đúng, khổ giấy đúng `tuiMarkdown.exportPageSize` (mặc định A4).
- [ ] HTML thô ở đây thì ĐƯỢC render (khác DOCX, vì đường PDF đi qua `remark-rehype` với
      `allowDangerousHtml`).
- [ ] Nếu máy không có Chromium: phải có thông báo lỗi nói rõ, không im lặng.

---

## E. Popup gõ

### E1. `@` mention và `[[` wiki link (#88): POPUP ĐÃ TỰ ĐỘNG

Hai floor check: `@ mention popup lists workspace files` (2 mục) và
`[[ wiki link popup lists workspace files` (1 mục), cả hai gắn `#editor-container`.
Phần chèn bằng Enter và lời mời tạo file thì chưa.

- [x] ~~Gõ `@`: popup danh sách file hiện ra.~~ floor
- [x] ~~Gõ `[[`: popup thứ hai hiện ra.~~ floor
- [ ] Gõ thêm vài ký tự: danh sách lọc mờ (fuzzy) theo ký tự đó.
- [ ] Mũi tên lên/xuống đổi lựa chọn, Enter chèn, Escape đóng mà không chèn.
- [ ] Sau khi chèn: trong source view nó là một link markdown đúng cú pháp.
- [ ] Gõ `[[`: popup thứ hai, cùng cách điều khiển.
- [ ] Gõ tay `[[Tên Chưa Có]]` (bỏ qua popup), rồi **bấm vào** wiki link đó: hiện toast
      `file "Tên Chưa Có.md" not found. Create it?` kèm nút `Create`. Bấm Create thì file
      rỗng được tạo **cạnh tài liệu** và mở ra. `#123` đổi hành vi này từ toast cảnh báo
      suông sang lời mời tạo.
- [ ] Gõ `[[../ngoài-thư-mục]]`: KHÔNG được mời tạo, chỉ báo not found. Chặn path
      traversal là chủ ý.
- [ ] Ở mức zoom khác 100%, cả hai popup vẫn bám đúng caret.

---

## F. Thụt lề danh sách

### F1. `editor.tabSize` đổi thì thụt lề editor ghi ra đổi theo (#102)

`tuiMarkdown.listIndent` mặc định là `"editor"`, nghĩa là bám
`editor.insertSpaces` / `editor.tabSize` đã resolve cho ngôn ngữ `markdown`.

- [ ] Đặt `"[markdown]": { "editor.tabSize": 4 }` trong settings của workspace.
- [ ] Tạo một danh sách lồng trong editor, lưu, xem source: thụt **4 dấu cách**.
- [ ] Đổi về `2`, sửa một chữ trong danh sách rồi lưu: thụt thành **2 dấu cách**.
- [ ] Đặt `tuiMarkdown.listIndent` thành `"tab"`: thụt bằng ký tự tab thật.
- [ ] Lưu lần thứ HAI mà không sửa gì: nội dung KHÔNG đổi thêm nữa. Đây chính là lỗi
      #102 báo, dòng nối thụt bằng tab tách khỏi item của nó ở lần lưu thứ hai.

---

## G. Giao diện

### G1. Ảnh chụp trước và sau ở hai theme (#86)

`#86` dời 2.356 dòng CSS từ `markdownEditorProvider.ts` sang `src/webview/editor.css`,
và tuyên bố là **không đổi một declaration nào**. Không có lưới tự động nào kiểm được
tuyên bố đó, chỉ có mắt.

- [ ] Mở cùng một tài liệu ở một theme SÁNG (ví dụ Frame), chụp màn hình.
- [ ] Đổi sang theme TỐI tương ứng (Frame Dark), chụp màn hình.
- [ ] So với bản trước `#86` nếu còn giữ. Nếu không còn: soát mắt heading, bảng, code
      block, alert, task list, ảnh, sơ đồ mermaid, sidebar mục lục, thanh công cụ.
- [ ] Đổi qua đủ 12 theme một lượt: không theme nào vỡ layout hoặc mất màu chữ.

---

## Hai mục floor CỐ Ý không nhận

Không tính vào 14, nhưng nếu đã ngồi xuống thì làm luôn.

### X1. Git Graph mở diff `.md` (#48)

`#122` chữa việc MỞ file và điều đó nay có bằng chứng tự động: floor check mở sample
dưới ba trạng thái `workbench.editorAssociations` và đọc lại editor nào thắng. Diff
editor là một ĐƯỜNG KHÁC trong VS Code, và floor workspace không cài Git Graph.

- [ ] Cài Git Graph, bấm vào một commit có sửa file `.md`, xem diff.
- [ ] Nếu diff vẫn mở bằng editor WYSIWYG: đó là một defect KHÁC `#122`, mở issue mới,
      đừng mở lại `#48`.
- [ ] Thử cả với `"workbench.editorAssociations": {"*.md": "default"}` ở workspace.

### X2. Các menu TRÔNG như thế nào

Floor check khẳng định menu có hiện ra và có đúng số mục. Nó không nói gì về việc chúng
đẹp hay xấu.

- [ ] Menu slash (gõ `/`), bubble menu, link popover, menu chuột phải bảng, lightbox:
      canh lề, khoảng cách, màu chữ trên nền, trạng thái hover, ở cả theme sáng và tối.

---

## Bảng kết quả

Ngày kiểm: `__________`  ·  Phiên bản: `2.17.0`  ·  VS Code: `__________`

Chỉ liệt kê phần CÒN LẠI. Những mục floor đã nhận thì `npm run verify:vscode-floor`
trả lời, đừng chép tay lại.

| Mục | Tiêu chí | Kết quả | Ghi chú / issue mở |
| --- | --- | --- | --- |
| A1b | Enter kích hoạt một mục trong menu bảng (#118) | | |
| A2 | `Ctrl/Cmd+Shift+M` hai chiều (#108) | | |
| A3b | Bubble menu ở zoom DƯỚI 100% (#116) | | |
| B1 | Gõ rồi đóng tab trong 300 ms, 10 lần (#104) | | |
| C1 | Clipboard lỗi có báo (#105) | | |
| C2 | Dán ảnh (#88) | | |
| C3 | Đổi tên ảnh (#88) | | |
| C4b | Ảnh xoá có vào Thùng rác không (#88) | | |
| E1b | Chèn bằng Enter, và lời mời tạo file (#123) | | |
| F1 | `editor.tabSize` đổi thụt lề (#102) | | |
| G1 | Ảnh chụp hai theme (#86) | | |
| X1 | Git Graph diff (#48) | | |
| X2 | Dáng các menu | | |

**Luật ghi kết quả**, giống luật áp cho worker: mục nào không chạy được thì ghi "chưa
kiểm được" kèm lý do, đừng ghi ĐẠT. Một dòng ĐẠT sai còn tệ hơn một dòng bỏ trống, vì
nó xoá món nợ khỏi tầm nhìn mà không trả nó.
