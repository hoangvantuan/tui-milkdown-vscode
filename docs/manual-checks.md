# Bản kiểm tay: 14 tiêu chí không có lưới tự động nào chạm tới

Mười bốn tiêu chí dưới đây đã dồn lại qua bốn sóng worker. Chúng KHÔNG phải việc còn
thiếu code: mã đã ship, chỉ là chưa ai ngồi trước một cửa sổ VS Code thật mà xác nhận.
Cái nào tự động hoá được thì đã nằm trong `npm run verify:vscode-floor` (29 check) rồi;
những cái ở đây cần clipboard hệ thống, hộp thoại lưu file, Thùng rác, tiêu điểm bàn
phím thật, hoặc mắt người.

**Cách dùng.** Mở chính file này bằng extension (chuột phải > Open With > TUI Markdown)
rồi tick trực tiếp. Mỗi mục ghi rõ: làm gì, ĐẠT nghĩa là gì, và cái bẫy đã biết. Mục nào
trượt thì mở issue mới, dán đúng dòng quan sát được, đừng sửa ngay tại chỗ.

**Trước khi bắt đầu:**

```bash
npm run build          # bản production, đúng thứ người dùng chạy
```

Rồi F5 (Extension Development Host), hoặc `npm run package` và cài file `.vsix`. Mở một
thư mục có ít nhất: một file `.md` dài hơn hai màn hình, một thư mục `images/`, và một
file `.md` thứ hai để kiểm wiki link.

Ghi kết quả ở bảng cuối file.

---

## A. Bàn phím và tiêu điểm

Ba mục này chỉ cần bàn phím, làm liền một mạch được.

### A1. Menu chuột phải trên bảng dùng được bằng bàn phím (#118)

Đây là mục floor check **chịu thua rõ nhất**, đã thử ba cách và hỏng cả ba (range
selection đặt bằng script không sync vào ProseMirror; click qua CDP dùng toạ độ trang
chứ không phải toạ độ iframe; `defaultPrevented` không phải bằng chứng vì webview của
VS Code tự huỷ `contextmenu`). Nên nó nằm đây.

- [ ] Chuột phải vào một ô bảng, menu hiện ra.
- [ ] Nhấn Tab và mũi tên lên/xuống: tiêu điểm chạy qua từng mục, **nhìn thấy được** là
      mục nào đang được chọn.
- [ ] Home nhảy về mục đầu, End nhảy xuống mục cuối.
- [ ] Enter trên một mục **thực thi** mục đó. Đây chính là lỗi #118 đã sửa: trước đây
      menu bắt `mousedown` nên Enter không làm gì cả.
- [ ] Escape đóng menu VÀ trả tiêu điểm về editor (gõ một ký tự, nó phải vào tài liệu).
- [ ] Ba mục căn lề trái / giữa / phải đổi đúng cột đang đứng.
- [ ] Bấm vào một `<select>` gốc của hệ thống bên trong menu (nếu có) không làm menu tự
      đóng. Đây là lý do phần đóng-khi-click-ra-ngoài cố ý vẫn giữ `mousedown`.

### A2. `Ctrl/Cmd+Shift+M` chạy từ CẢ HAI phía (#108)

- [ ] Mở Keyboard Shortcuts (`Cmd+K Cmd+S`), gõ "TUI": phải thấy **cả hai** lệnh,
      `View Source` và `View Rich Text (WYSIWYG)`, cùng gán `Ctrl/Cmd+Shift+M`.
- [ ] Đang ở editor WYSIWYG, bấm tổ hợp: chuyển sang source.
- [ ] Đang ở source, bấm tổ hợp: quay lại WYSIWYG. Đây là chiều trước đây KHÔNG có
      đường về ngoài icon trên thanh tiêu đề.

### A3. Bubble menu ở mức zoom KHÁC 100% (#116)

Toàn bộ popup trong repo này gắn vào `#editor-container` chứ không gắn vào `.tiptap`,
vì CSS `zoom` trên `.tiptap` trong suốt với các API toạ độ của JS. Đây là phép kiểm duy
nhất chứng minh bubble menu làm đúng luật đó.

- [ ] Ở 100%: bôi đen một đoạn chữ, bubble menu hiện **ngay cạnh vùng chọn**.
- [ ] Bấm `Cmd/Ctrl +` hai lần (lên khoảng 120%), bôi đen lại: menu vẫn bám đúng vùng
      chọn, không lệch xuống hoặc sang phải.
- [ ] `Cmd/Ctrl -` xuống dưới 100%, bôi đen lại: vẫn đúng.
- [ ] Năm nút Bold, Italic, Code, Link, Highlight đều tác động đúng vùng đang chọn.

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

### B2. Vị trí con trỏ và cuộn nhớ theo từng file (#121)

Lưu ở `workspaceState` của extension host chứ không ở `vscode.setState()`, vì webview
này không bật `retainContextWhenHidden`: ẩn tab là webview bị huỷ, `setState` đi theo.

- [ ] Mở file dài, cuộn xuống khoảng giữa, đặt con trỏ vào một đoạn nhận ra được.
- [ ] Đóng tab, mở lại: **đúng chỗ cũ**, cả cuộn lẫn con trỏ.
- [ ] Chuyển sang tab khác rồi quay lại (không đóng): vẫn đúng chỗ.
- [ ] Mở file thứ hai ở vị trí khác, qua lại giữa hai file: mỗi file nhớ vị trí riêng.
- [ ] Đóng hẳn VS Code, mở lại workspace: vị trí còn đó (đây là chỗ `workspaceState`
      khác `setState`, và là lý do chọn nó).

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

### C4. Xoá ảnh khỏi markdown thì file vào Thùng rác (#88)

Cần `tuiMarkdown.autoDeleteImages` đang bật (mặc định bật).

- [ ] Xoá dòng ảnh khỏi tài liệu, **lưu**.
- [ ] File ảnh vào Thùng rác (Trash), KHÔNG bị xoá vĩnh viễn.
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

### D1. Export DOCX (#88)

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

### D2. Export PDF (#88)

Cần một Chromium thật. `tuiMarkdown.chromiumPath` để trống thì tự dò
Chrome/Edge/Chromium/Brave.

- [ ] Chọn `PDF`, bấm `Export`, lưu.
- [ ] Mở file: nội dung đúng, khổ giấy đúng `tuiMarkdown.exportPageSize` (mặc định A4).
- [ ] HTML thô ở đây thì ĐƯỢC render (khác DOCX, vì đường PDF đi qua `remark-rehype` với
      `allowDangerousHtml`).
- [ ] Nếu máy không có Chromium: phải có thông báo lỗi nói rõ, không im lặng.

---

## E. Popup gõ

### E1. `@` mention và `[[` wiki link (#88)

- [ ] Gõ `@` giữa một đoạn văn: popup danh sách file hiện ra.
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

| Mục | Tiêu chí | Kết quả | Ghi chú / issue mở |
| --- | --- | --- | --- |
| A1 | Menu bảng dùng bằng bàn phím (#118) | | |
| A2 | `Ctrl/Cmd+Shift+M` hai chiều (#108) | | |
| A3 | Bubble menu ở zoom khác 100% (#116) | | |
| B1 | Gõ rồi đóng tab trong 300 ms (#104) | | |
| B2 | Nhớ vị trí con trỏ và cuộn (#121) | | |
| C1 | Clipboard lỗi có báo (#105) | | |
| C2 | Dán ảnh (#88) | | |
| C3 | Đổi tên ảnh (#88) | | |
| C4 | Xoá ảnh vào Thùng rác (#88) | | |
| D1 | Export DOCX (#88) | | |
| D2 | Export PDF (#88) | | |
| E1 | `@` mention và `[[` wiki link (#88) | | |
| F1 | `editor.tabSize` đổi thụt lề (#102) | | |
| G1 | Ảnh chụp hai theme (#86) | | |
| X1 | Git Graph diff (#48) | | |
| X2 | Dáng các menu | | |

**Luật ghi kết quả**, giống luật áp cho worker: mục nào không chạy được thì ghi "chưa
kiểm được" kèm lý do, đừng ghi ĐẠT. Một dòng ĐẠT sai còn tệ hơn một dòng bỏ trống, vì
nó xoá món nợ khỏi tầm nhìn mà không trả nó.
