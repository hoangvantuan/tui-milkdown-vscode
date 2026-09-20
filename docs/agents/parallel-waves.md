# Chạy một sóng worker song song

Cách điều phối nhiều agent cùng sửa repo này. Viết sau sóng 3 (2026-09-16), khi
bốn worker `agy` chạy song song đóng tám issue roundtrip.

Đây là tri thức QUY TRÌNH, dùng lại cho mọi sóng sau. Phần trạng thái ở cuối là
ảnh chụp một thời điểm; git log và issue tracker mới là nguồn đúng.

## Công thức phóng worker agy, ĐÃ CHỨNG MINH ở sóng 3

`agy` KHÔNG phải agent orca biết (`worker-start --agent agy` trả
`agent_unconfigured`). Bắt buộc theo lối terminal-first.

Dựng sẵn worktree trước, sóng 4 làm thế này và chạy trơn:

```
orca worktree create --repo id:<repo_id> --name <tên> --base-branch develop   --no-parent --setup skip --json
  -> ~/orca/workspaces/<repo>/<tên>, nhánh <gituser>/<tên>

repo này KHÔNG có setup hook, nên node_modules phải tự lo.
cp -Rc node_modules <worktree>/node_modules   # APFS clone, tức thì; đừng npm ci
```

Spec đặt ở `<worktree>/.wave4-spec/` rồi thêm `.wave4-spec/` vào
`.git/info/exclude` của repo GỐC (worktree liên kết dùng chung file đó). Worker
đọc được vì spec nằm trong workspace của nó, và không bao giờ lọt vào commit.
Đặt spec ngoài repo cũng chạy nhưng mất lợi thế đó.

Rồi mới tới phần terminal:

```
1. thêm ĐÚNG đường dẫn worktree vào trustedWorkspaces của agy
   ~/.gemini/antigravity-cli/settings.json, khớp chính xác, không phải prefix

2. orca terminal create --worktree path:<worktree> --command "agy" --json

3. đợi tới khi terminal read thấy "Antigravity CLI", rồi gửi một prompt vô hại
   để xác nhận tài khoản chạy được turn. Thanh trạng thái ghi "AI: Out of
   credits" nhưng model VẪN trả lời. Đừng tin thanh đó, tin phép thử.

4. orca orchestration worker-start --run <run_id> --spec "<đoạn ngắn trỏ file spec>" \
     --terminal <handle> --worktree path:<worktree> --json

5. terminal read lại: PHẢI thấy preamble + === TASK === + worker tự gọi
   orca orchestration check. Không thấy thì dừng, đừng đi tiếp.

6. bằng chứng cuối cùng là HEARTBEAT về tới hộp thư. Đủ số heartbeat bằng số
   worker thì token dispatch đã tới nơi cả lượt.
```

Cú pháp hay nhầm: `orca terminal send --terminal <h> --text "..." --enter
--wait-submit 20 --json`. Cờ là `--enter`, không phải `--submit`, và
`--wait-submit` cần một số GIÂY (tối đa 3600).

## Bẫy đã dính, kèm cách chữa

**agy nén hội thoại quanh 1.5M token rồi CHẾT LẶNG.** Sau khi nén, agent mất
nghĩa vụ dispatch trong preamble, tưởng xong việc, về prompt im lặng mà không
gửi `worker_done`. Xảy ra với 2 trên 4 worker sóng 3.

- Dấu hiệu: `worker-list` cho `activity='done'` nhưng `outcome='in_progress'`.
  ĐỪNG chỉ ngồi chờ `worker_done`, phải chủ động rà cặp này.
- `orca orchestration send` KHÔNG đánh thức được worker đang nhàn rỗi. Guide đã
  nói trước: "best-effort attention only". Hộp thư chỉ tới được worker ĐANG chạy.
- Sóng 4 còn thấy điều tệ hơn: worker ĐANG CHẠY cũng không đọc hộp thư kịp. Một
  chỉ thị khẩn gửi qua `orchestration send` nằm im hơn 15 phút với cả bốn worker,
  TUI chỉ hiện dòng "You have 1 orchestration message" mà agent không tự chạy
  `check`. Trong 15 phút đó thêm một worker nữa khởi động đúng cái lệnh bị cấm.
  Việc gì đổi luật giữa chừng thì gửi bằng `orca terminal send`, nó tới nơi ngay.
- Và phải VÁ LUÔN FILE SPEC trong worktree, không chỉ gửi tin. Worker bị nén hội
  thoại sẽ đọc lại spec; nếu spec còn luật cũ thì nó quay về làm đúng cái vừa bị
  cấm. Sóng 4 chèn một mục "SỬA ĐỔI GIỮA SÓNG" ngay dưới tiêu đề H1 của cả hai
  file spec, nói rõ nó thắng mọi câu khác trong file.
- Cách chữa chắc chắn: `orca terminal send` gõ thẳng vào TUI.
- Khi đánh thức PHẢI TÁI NEO bối cảnh: worker nào, worktree nào, nhánh nào, spec
  ở đâu, đã làm tới đâu, còn thiếu gì. Bảo suông "làm tiếp" là vô nghĩa với một
  agent vừa mất trí nhớ.
- Phòng ngừa: bắt worker COMMIT SỚM ngay trong spec. Một worker đã treo 184 dòng
  chưa commit lúc đứng im.

**Bash của điều phối viên chết cứng ở 600000ms.** Đừng đặt `--timeout-ms 900000`.
Dùng <= 540000, hoặc chạy nền.

**`orca orchestration check` in HAI tài liệu JSON liền nhau** khi vừa ack vừa
wait, và còn chen các dòng `{"_keepalive":true,...}`. `json.load` sẽ nổ. Dùng
`JSONDecoder.raw_decode` trong vòng lặp và bỏ qua doc có `_keepalive`.

**Terminal do điều phối viên tự tạo** thì `worker-release` không tự đóng. Phải
tự `orca terminal close`.

**`verify:vscode-floor` từng KHÔNG chạy được hai lượt cùng lúc. ĐÃ SỬA ở sóng 5,
`#110`.** Giữ lại mục này vì cách truy nguyên nhân mới là thứ đáng dùng lại.

Sóng 3 quy cho tải CPU. Sai. Sóng 4 truy ra cơ chế thật: `harness/vscode-floor/run.mjs`
lấy `ws`, `ud` và `ext` từ MỘT thư mục cố định dùng chung, `/tmp/tuimd-floor`,
không pid, không `mkdtemp`, không khoá. Hai lượt song song ghi đè `ws/sample.md`
của nhau và dùng chung user-data-dir, tức chung cả IPC socket lẫn cơ chế
một-thực-thể của VS Code. Đúng cửa sổ 25 giây mà check `document still unmodified
after the hold` đang đo. Sóng 5 đọc lại code còn thấy một điều thân issue chưa
ghi: lượt thứ hai `rmSync` nguyên thư mục nền ngay lúc khởi động, tức là XOÁ
SỐNG cây thư mục của lượt đang chạy.

Bài học dùng lại được: một check "nhạy với tải máy" hầu như luôn là một tài
nguyên dùng chung bị giấu. Trước khi quy cho tải, hãy đi tìm thư mục cố định,
cổng cố định, cache dùng chung, khoá toàn cục. Sóng 5 tìm thêm được một cái thứ
hai trong cùng file mà issue không nêu: cache tải VS Code ở
`~/.cache/tui-markdown-vscode-floor/` cũng bị hai lượt lạnh cache giẫm lên nhau.

Nay mỗi lượt có `mkdtemp` riêng và mọi lần ghi vào cache đều staging rồi rename,
nên **worker được phép chạy lệnh đó**. Bằng chứng: hai lượt phóng cùng lúc, cả
hai 15/15, hai base khác nhau.

**Worker vừa `ask` vừa xong việc thì câu hỏi TỰ ĐÓNG.** Sóng 5: W2 gửi một câu
hỏi hay, rồi tự chọn một phương án và gửi `worker_done` trước khi tôi kịp trả
lời. `orchestration reply` khi đó trả `dispatch_inactive`, câu trả lời không tới
nơi, và phương án nó tự chọn chính là phương án sai. Mất trọn một vòng.

- Chữa: đọc hộp thư SỚM và THƯỜNG. `check --wait` với timeout ngắn ngay sau khi
  phóng, đừng đợi tới khi rảnh. Câu hỏi có hạn sử dụng.
- Và viết thẳng trong spec: "gửi `ask` xong thì làm tiếp phần khác, ĐỪNG kết
  thúc trước khi có trả lời cho câu đã hỏi". Sóng 5 chưa có câu này.
- Nếu đã lỡ: `orca terminal send` gõ thẳng, hoặc phóng một dispatch vòng hai.
  Tôi làm cách thứ hai và nó chạy gọn.

**ĐIỀU PHỐI VIÊN ĐỪNG TỰ TAY `rm -rf /tmp/tuimd-floor-*` GIỮA SÓNG.** Sóng 5 tôi
làm đúng thế để dọn trước một phép đo, trong lúc W1 đang chạy floor check. Đó
chính là bug `#110`, làm bằng tay. `#110` đã bỏ lệnh `rmSync` khỏi code; đừng
mang nó trở lại bằng ngón tay mình.

**`harness/corpus.ts` quét mọi `*.md` ở GỐC repo làm corpus.** Cấm worker tạo
tài liệu tạm ở đó. `docs/` an toàn.

**Bước kiểm vòng hai ghi đè 22 fixture, bước khôi phục rất dễ quên.** Đã xảy ra
thật ở sóng 3. Nếu lọt vào commit thì input thô bị thay bằng output, roundtrip
VẪN BÁO XANH, và mất im lặng. Chốt chặn bắt buộc trước mỗi merge:

```
MB=$(git merge-base develop HEAD)          # TRONG worktree của nhánh
git diff $MB..HEAD --stat -- harness/fixtures/synthetic/
```

**Sóng 5 sửa lệnh này. Bản cũ là `git diff develop..<nhánh>` và nó cho kết quả
SAI ngay khi `develop` đã tiến lên sau lúc nhánh tách ra**, tức là mọi sóng có
nhiều hơn một lần merge. Nó so hai ĐỈNH, nên mọi thứ điều phối viên vừa đưa vào
`develop` hiện ra thành dòng XOÁ của nhánh. Lần đầu tôi chạy nó ở sóng 5, nó báo
worker đã xoá 124 dòng của `run.mjs` và 85 dòng của `extension-tests.ts`; worker
không đụng file nào trong số đó. Luôn so với merge-base.

Chỉ được có fixture MỚI. Fixture CŨ bị sửa thì chặn lại, bắt worker tự khôi
phục, đừng sửa hộ.

**Nhưng một fixture MỚI cũng có thể là fixture rỗng ruột.** Chốt chặn trên chỉ
bắt được fixture CŨ bị sửa. Sóng 4: `#106` đòi fixture chứa `<u>x</u>` và `++x++`
để golden chứng minh phép chuyển sang `<ins>`. Fixture mà worker giao đã chứa
`<ins>` ở mọi dòng, kể cả hai dòng tự nhận là ca `<u>` và ca `++x++`. Đầu vào thô
đã bị thay bằng đầu ra. Roundtrip xanh, chốt chặn qua, mà hai trong năm ca không
ghim gì cả.

Phép thử duy nhất đáng tin, bắt buộc với mọi fixture mới ghim một extension:

```
gỡ extension khỏi harness/editor.ts  ->  fixture PHẢI ĐỎ
trả lại                              ->  fixture PHẢI XANH
```

Bắt worker tự chạy và dán output cả hai lần. Áp cùng cách cho seam: gỡ extension
ra rồi đếm xem BAO NHIÊU ca trong seam đổi. Seam `list-keys` của `#107` có 5 trên
8 ca đổi; ba ca còn lại giống nhau vì chúng là hành vi upstream, tức là chốt
chống hồi quy, và đó là lành mạnh. Nếu con số đó bằng 0 thì seam không đo gì.

**Phép thử răng áp cho MỌI loại kiểm, không riêng fixture.** Sóng 5 mở rộng nó
sang unit test và sang check của floor harness, và nó bắt được lỗi ở cả hai chỗ:

```
unit test:  phá một hàm  ->  đếm BAO NHIÊU ca đỏ
floor check: bỏ rỗng một case trong switch  ->  check tương ứng PHẢI đỏ
```

W2 giao hai ca test mà khẳng định cốt lõi là `assert.equal(renamesExecuted, false)`
với `renamesExecuted` do CHÍNH TEST đặt bên trong một `if` do CHÍNH TEST viết.
Hai ca đó khẳng định câu lệnh `if` của JavaScript chạy đúng; phá bất kỳ hàm nào
trong module chúng vẫn xanh. Cùng một bệnh với fixture rỗng ruột của sóng 4, chỉ
đổi vỏ. **Con số ca đỏ là thứ phải hỏi, không phải "test có xanh không".**

**Tự đo cũng phải kiểm lại phép đo.** Sóng 5 tôi đo "thân case dài nhất" bằng
cách lấy biên là `case` kế tiếp, và nhận được 423 dòng cho `case "export"`. Con
số đó sai: `export` là case CUỐI nên phép đo đếm tới hết file. Suýt nữa tôi trả
nhầm việc đúng về cho worker. Khi con số của mình chọi con số của worker, hãy
nghi phép đo của mình TRƯỚC.

## Kỷ luật đã chứng minh là đáng giá

**Đừng tin báo cáo của worker.** Fixture VÀ golden đều do worker tự viết, nên
roundtrip xanh là lập luận vòng tròn. Phải tự dựng ca tái hiện lấy THẲNG TỪ THÂN
ISSUE rồi chạy độc lập. Sóng 3 làm 14 ca như vậy.

**agy dưới Gemini Flash bịa BÁO CÁO trong khi MÃ thì đúng.** Đây là dạng hỏng của
sóng 4, và nó khó bắt hơn dạng bịa đều. Báo cáo của W1 liệt kê 20 tên loại message
không tồn tại (`exportDocx`, `searchFiles`, `toggleBreadcrumbs`...), trích khối mã
`showError` sai cả chữ ký lẫn nội dung, viết `storedPostMessage` trong khi mã thật
là `vscode.postMessage`, và mô tả một phép thử chưa từng chạy ở thì quá khứ. Cùng
báo cáo đó, claim về `document.isClosed` lại ĐÚNG. Mã nguồn thì sạch: 33 literal
khớp chính xác bản kiểm kê.

Đừng đọc báo cáo bằng mắt, kiểm bằng máy: bóc mọi khối mã trong báo cáo ra rồi
`grep -F` ngược vào file được nêu tên. Khối nào không khớp file nào là khối bịa,
trừ output lệnh.

Rồi trả về cho worker sửa, kèm luật cứng: mọi khối mã phải SINH RA bằng `sed -n`
rồi dán y nguyên, mọi danh sách phải sinh bằng `grep`, mọi phép thử phải kèm lệnh
và output thật, phép thử nào không chạy được thì viết thẳng là chưa kiểm được. W1
sửa xong trong một vòng và bản thứ hai qua được phép kiểm bằng máy.

**Ghi rõ trong bản đóng issue tiêu chí nào CHƯA kiểm được.** Sóng 4 có bốn tiêu
chí kiểu đó, đều cần một cửa sổ VS Code sống: ép lỗi clipboard (`#105`), gõ rồi
Ctrl+W mười lần (`#104`), ảnh chụp trước/sau hai theme (`#86`), Keyboard Shortcuts
liệt kê hai lệnh (`#108`). Đóng issue mà im lặng về chúng là tự tạo một khoản nợ
vô hình.

**Issue của repo này có thể sai, tỉ lệ cao.** Sóng 3 bắt được `#99` có tiêu chí
tự mâu thuẫn (đòi sửa bug nhưng cấm golden đang chụp bug đó thay đổi), `#96` sai
nguyên nhân gốc, `#95` sót một nguyên nhân thứ hai. Cộng với `#93` và `#94` của
sóng 2 là 5 trên 13 ticket. Sóng 4 thêm hai, thành 7 trên 24. Sóng 5 thêm ba,
thành 8 trên 26. Sóng 6 thêm hai, thành 10 trên 28. Sóng 7 là một ca khác hẳn về
hình dạng: một thân issue MẸ (`#84`) sai cơ chế ở BẢY chỗ cùng lúc, nhưng cả bảy đều
bị điều phối viên đo ra và sửa TRƯỚC khi viết ticket con, nên không worker nào gặp.
Tỉ lệ luỹ kế giữ ở 10 trên 28 ticket giao đi, và con số đáng nhớ hơn là bảy. Sóng 6
thì cả hai lần thân issue sai ở CƠ CHẾ chứ không ở triệu chứng: `#111` trỏ vào cái guard (`isUpdatingFromExtension`) trong khi nguyên nhân là `trailingNode` của StarterKit, `#112`
trỏ vào ngân sách 40 giây trong khi nhiều khả năng là `requestAnimationFrame`
không chạy cho cửa sổ bị che. Đọc issue xong VẪN phải tự kiểm bằng code.

Hai ca của sóng 4, cả hai đều do worker phát hiện rồi `ask`, đúng như spec dạy:

- `#105` bảo trả lỗi về "để webview bật toast lỗi sẵn có (`showError`)". Không hề
  có toast. `showError` gán thẳng `editorEl.innerHTML`, nó là màn hình lỗi chí
  mạng, ba chỗ gọi hiện có đều là ca editor không dựng nổi. Làm theo issue là xoá
  trắng tài liệu người dùng đang mở, tức tệ hơn hẳn cái lỗi im lặng đang cần chữa.
- `#91` bảo đặt comment "ở chỗ serialize list". Repo không có chỗ đó: list do
  `@tiptap/extension-list` serialize. Nếu để worker tự xoay, nó sẽ dựng một
  `renderMarkdown` mới cho list chỉ để có chỗ treo comment, và đâm thẳng vào nhánh
  đang làm `#109`. Chỗ đúng là header của `BlankLineHandler`.

Bài học chung: khi thân issue trỏ vào một cơ chế, hãy tự mở file ra xem cơ chế đó
CÓ THẬT không, trước khi chép nó vào spec. Cả hai lần trên tôi đã chép nguyên câu
sai từ issue vào spec, và worker là người phát hiện.

**DỰNG LƯỚI TRƯỚC KHI GIAO VIỆC, đây là bài học lớn nhất của sóng 5.**

`#88` đòi viết lại một phương thức 1.136 dòng giữ toàn bộ hợp đồng per-document
trong biến closure. Không một phép kiểm tự động nào của repo chạm tới nó:
roundtrip harness đo một chuỗi đi qua editor, không đo một provider đi qua VS
Code. Giao việc đó cho worker với lưới rỗng là đánh bạc.

Nên điều phối viên tự làm ba việc TRƯỚC khi phóng, theo đúng thứ tự:

```
1. sửa #110 (thư mục dùng chung)  -> gỡ được lệnh cấm worker chạy floor check
2. mở rộng floor harness 15 -> 19 check, lái webview thật
3. đo răng của 4 check mới TRÊN MÃ CHƯA REFACTOR, rồi mới tách worktree cho W1
```

Thứ tự này là bắt buộc. Đo răng trên mã chưa refactor mới cho ra con số mà
worker phải giữ xanh; đo sau khi worker đã sửa thì không còn là mốc nữa. Và vì
worktree của W1 tách SAU bước 2, nó thừa hưởng lưới mà không phải merge gì.

Kết quả: bốn check mới có răng đo được (bỏ rỗng `case "edit"` thì đỏ, bỏ rỗng
`case "viewSource"` thì đỏ), và bản refactor 1.737 dòng xuống 460 dòng qua được
19/19 ngay lần chạy đầu trên nhánh đã merge.

Ghi luôn chỗ lưới YẾU, đừng chỉ khoe chỗ mạnh. Check "edit không dội ngược"
KHÔNG đỏ khi gỡ riêng chốt `!pendingEdit` của host, cũng KHÔNG đỏ khi gỡ riêng
chốt `lastSentState` của webview, vì các chốt xếp lớp. Nó là check bất biến, không
phải check đơn vị. Tôi viết câu đó vào cả spec của worker lẫn commit message, để
không ai đọc màu xanh của nó thành nhiều hơn sự thật.

**KHÔNG TÁI HIỆN ĐƯỢC thì đo cái phân biệt được, rồi ship chính cái thước đó.**
Sóng 6, `#112` khẳng định 40 giây quá ngắn dưới tải. Tôi đo 1 lượt, 3 lượt,
6 lượt, rồi 3 lượt với cả 12 nhân bão hoà (load average 24): mermaid render
xong sau 1.5 giây ở MỌI mức, chỉ có thời điểm mount trượt từ 1.5 lên 5.6 giây.
Nâng ngân sách theo lời issue sẽ là đoán khoác áo bản vá. Thay vào đó tách hai
ngân sách (mount và mermaid, đếm từ lúc mount) và làm cho dòng detail tự phân
biệt "còn đang tải" với "render hỏng". Một giờ sau nó đỏ thật, ba lượt liền,
`STILL LOADING after 40748ms`, và chính dòng detail mới nói ra rằng 40 giây
không-làm-gì không phải là chậm. Rồi thêm hai trường `scheduled=` và
`visibility=` để lần đỏ sau tự trả lời câu hỏi còn lại.

Lần đỏ sau tới trong cùng phiên, và hai trường đó trả lời ngay:
`scheduled=0 visibility=hidden`. Render lần đầu được lên lịch trong một
`requestAnimationFrame`, mà Chromium không chạy rAF cho cửa sổ nó coi là không
hiển thị, nên cửa sổ bị che thì KHÔNG CÓ LỊCH NÀO cả, và không ngân sách nào
cứu được. Bug sản phẩm, không phải bug harness. Thước đo là thứ giao được, kể
cả khi kết luận thì chưa, và ở đây chính nó đã tự tìm ra kết luận.

**Ép đúng ĐIỀU KIỆN, và ép cho đúng LÚC.** Phép thử răng cho `#112` suýt cho
kết quả sai. Thu nhỏ cửa sổ VS Code mỗi 2 giây thì check VẪN XANH kể cả khi đã
gỡ bản vá, vì tới lúc thu nhỏ thì animation frame đã kịp chạy; probe đọc thấy
`visibility=hidden` nên trông như đã ép thành công. Chỉ khi ép lại mỗi 0.3 giây
ngay từ giây đầu, tức HIDDEN TRƯỚC KHI tài liệu nạp, nó mới đỏ với
`scheduled=0`. Một điều kiện đặt đúng nhưng muộn là một phép thử răng cùn mà
trông vẫn sắc.

**Phép thử răng cũng phải kiểm phép thử.** Sóng 6, check mới cho `#111` so
`textContent` của cả `.tiptap`, và nó đỏ với `len 6194->256`. Không phải tài
liệu sai: `.tiptap` chứa cả chữ trong SVG mermaid và badge ngôn ngữ của code
block, mà chính bug đang đo lại khiến tài liệu bị dựng lại, nên các thứ đó
biến mất. Phép đo đang báo TRIỆU CHỨNG của bug như thể là hỏng phép đo. Thu
hẹp về đúng đoạn văn đích thì nó đo đúng thứ cần. Bài học: khi một check mới
đỏ, hỏi "nó đỏ vì thứ tôi định đo, hay vì thứ tôi vô tình quét vào".

**Đo trước khi chia việc.** Sóng 3 gộp `#97 #99 #100 #101` về một worker vì đo
được cả bốn dồn vào `MarkdownManager.escapeMarkdownSyntax`, và `#99` với `#101`
đòi hai điều ngược nhau từ CÙNG một quy tắc cho ký tự `[`. Đưa sẵn cơ chế vào
spec nên worker không mất vòng nào để mò. Đây là thứ tiết kiệm nhiều nhất.

Sóng 4 làm lại cách đó và vẫn đúng: dựng bảng "hàm nào bị ai chạm" trước khi chia,
rồi gộp theo CƠ CHẾ chứ không theo nhãn issue. `#109` và `#107` về một worker vì
cả hai là cơ chế list; `#87` và `#105` về một worker vì `#105` cần đúng cái union
mà `#87` tạo ra; `#104` bị CẮT ĐÔI theo ranh giới sở hữu, mẩu host về với `#87` vì
worker đó sở hữu `resolveCustomTextEditor`, và issue chỉ đóng sau khi cả hai nhánh
về đích.

Và biết HOÃN. `#88` bị hoãn vì nó bị `#87` chặn cứng, lại là hai PR viết lại đúng
cái file cả bốn worker đều chạm. Để chung sóng là cầm chắc xung đột không giải nổi.

**Phạm vi phình ra đôi khi là ĐÚNG.** W3 sửa `table-markdown-serializer.ts`, ngoài
spec. Không phải thừa: `#107` cho Tab tạo list lồng trong ô bảng, mà
`renderCellContent` cũ chỉ duyệt item cấp một và bỏ rơi im lặng mọi sub-list, nên
không sửa thì `#107` làm mất dữ liệu lúc lưu. Gặp phình phạm vi thì hỏi "thiếu nó
thì tính năng có sai không", đừng chặn theo phản xạ.

## LỖI CỦA ĐIỀU PHỐI VIÊN SÓNG 3, đừng lặp lại

Spec riêng của worker #102 (đã xoá cùng thư mục spec sóng 3) vừa cho worker
ngoại lệ được chạm
`list-continuation-underindented.md`, vừa ra ràng buộc "với mặc định 2 dấu cách
KHÔNG golden nào hiện có được đổi". Hai câu chọi nhau. Worker chọn cách an toàn
nên không chữa, và fixture đó vẫn đỏ tới giờ.

Bài học: khi nêu một ngoại lệ, phải nói luôn nó THẮNG ràng buộc nào.

Sóng 4 áp dụng bài học đó và nó chạy: spec của W3 nói thẳng "ngoại lệ seam THẮNG
ràng buộc 4" và "chốt chặn fixture THẮNG câu ghim marker của `#109`", nên worker
không mất một vòng nào để hỏi.

## LỖI CỦA ĐIỀU PHỐI VIÊN SÓNG 4, đừng lặp lại

**Chép nguyên câu sai từ thân issue vào spec.** Hai lần, `#105` và `#91`. Cả hai
lần worker là người phát hiện, tốn của mỗi bên một vòng hỏi đáp. Lẽ ra lúc đo để
chia việc, mỗi khi thân issue trỏ vào một cơ chế cụ thể (một hàm, một dòng, một
"chỗ" nào đó) thì phải mở file ra xác nhận cơ chế ấy có thật, y như cách tôi đã
làm với `#109` và nhờ đó xác nhận được nó đúng.

**Cấm `verify:vscode-floor` quá muộn.** Tôi chỉ nghĩ tới việc kiểm harness đó sau
khi đã thấy hai worker chạy nó song song. Khi lệnh cấm ra thì worker thứ ba đã
khởi động nó. Việc phải làm TRƯỚC khi phóng: rà xem lệnh kiểm nào dùng tài nguyên
dùng chung (thư mục cố định, cổng cố định, khoá toàn cục) và cấm sẵn trong spec.

## LỖI CỦA ĐIỀU PHỐI VIÊN SÓNG 5, đừng lặp lại

**Đọc hộp thư quá muộn, làm chết một câu `ask` hay.** W2 hỏi đúng chỗ issue sai,
rồi tự chọn phương án và kết thúc trước khi tôi đọc tới. `reply` sau đó trả
`dispatch_inactive`. Phương án nó tự chọn là phương án sai và tốn một vòng sửa.
Sóng 4 đã ghi bài học "worker không đọc hộp thư kịp"; sóng 5 cho thấy chiều
ngược lại cũng đúng: ĐIỀU PHỐI VIÊN cũng không đọc kịp. Phóng xong là mở
`check --wait` ngay, đừng đi làm việc khác trước.

**Tự tay `rm -rf /tmp/tuimd-floor-*` giữa sóng**, trong lúc W1 đang chạy floor
check, để dọn trước một phép đo của tôi. Tôi vừa sửa `#110` xong, và lập tức tái
hiện nó bằng ngón tay mình.

**Tin phép đo của mình hơn phép đo của worker, trong khi phép đo của mình sai.**
Xem mục "Tự đo cũng phải kiểm lại phép đo" ở phần kỷ luật.

**Không lường được `#112`.** Tôi kết luận `#110` đã làm floor check "chạy song
song an toàn" và viết câu đó vào `AGENTS.md` mà không thử quá hai lượt. Ba lượt
thì cả ba đỏ ở check mermaid. Câu của tôi đúng về tính đúng đắn (không hỏng dữ
liệu) nhưng bị đọc thành đúng về độ tin cậy. Đã sửa lại cả `AGENTS.md` lẫn
`harness/README.md` để tách hai khái niệm đó.

## LỖI CỦA ĐIỀU PHỐI VIÊN SÓNG 6, đừng lặp lại

**Suýt nâng một timeout theo lời thân issue.** Tôi đã viết sẵn
`MERMAID_TIMEOUT_MS = 180000` làm "tạm" rồi mới đo. Nếu bỏ qua bước đo thì con
số đó đã vào repo kèm một commit message nghe rất hợp lý, và nguyên nhân thật
(`requestAnimationFrame` không chạy cho cửa sổ bị che) sẽ không bao giờ lộ ra.
Thứ cứu tôi là phép đo, không phải sự cẩn thận. Hãy đo TRƯỚC khi gõ con số,
kể cả con số tạm.

**Phép đo đầu tiên của check mới quét quá rộng.** Xem mục "Phép thử răng cũng
phải kiểm phép thử" ở phần kỷ luật.

## LỖI VÀ BÀI HỌC CỦA SÓNG 8

**Marker block trong hai file dùng chung: hiệu quả, nhưng câu chữ của tôi thiếu một câu.**
Sóng 8 có HAI ticket markdown-relevant, nên luật cũ "chỉ một worker được chạm
`harness/editor.ts`" không dùng được. Thay bằng marker block, mỗi worker một khối, trong
cả `src/webview/main.ts` lẫn `harness/editor.ts`. Nó chạy: hai nhánh merge không xung đột
một dòng nào trong hai file đó.

Nhưng tôi viết "chỉ được thêm dòng BÊN TRONG marker block mang tên mình" mà quên nói dòng
`import` đi đâu. Worker tuân thủ theo nghĩa đen và viết `...require("./html-marks")` ngay
giữa mảng extension. esbuild nội tuyến `require()` tĩnh trong bundle IIFE nên không có
`require` nào sống trong file phát hành (`grep -c "require(" out/webview/main.js` trả 0),
tức là không hỏng, nhưng nó lệch với mọi import khác trong repo. **Câu phải thêm: "dòng
import đi lên đầu file như bình thường".** Đã sửa vào chính comment của marker.

**Một cơ chế lazy mới thì phải DỰNG NGUYÊN MẪU, đừng suy ra từ cái cũ.** Tôi suýt chép
nguyên khuôn mermaid cho KaTeX, drag handle và emoji. Mermaid là một thư viện độc lập; ba
thứ kia là extension cắm vào một editor đang sống, và một artifact mang theo bản
`prosemirror-state` riêng sẽ có PluginKey riêng và lớp `EditorState` riêng, nên `instanceof`
bên trong ProseMirror hỏng ở runtime mà không có gì hỏng lúc biên dịch. Nửa giờ dựng nguyên
mẫu trong sandbox trả lời dứt điểm: externalize `@tiptap/core` và `@tiptap/pm/*` về global,
`editor.registerPlugin()` chạy, plugin đếm 68 lên 69, `view.state instanceof EditorState`
vẫn đúng. Nếu không dựng, con số đó đã là một giả định nằm trong bốn bản spec.

Cùng phép đo đó còn bắt được một thứ spec suýt nói sai: `@tiptap/extension-emoji` khai một
node `emoji` KÈM `renderMarkdown`, mà schema thì cố định lúc `new Editor()`. "Dùng upstream,
lazy" là bất khả thi theo nghĩa đen, và tệ hơn, renderer đó có thể ghi `:smile:` đè lên ký
tự unicode người dùng đã lưu. Spec phải nói thẳng: lazy phần DỮ LIỆU, UI dùng
`suggestion-popup.ts`, chèn text unicode, không đụng schema.

**Thân issue MẸ sai một chỗ lớn, và điều phối viên đo ra trước khi viết ticket con.** #85
nói math "pass through but shows as source". Nửa đầu sai: `$\frac{a}{b}$` lưu ra
`$\\frac{a}{b}$` và `$$\int_0^1$$` ra `$$\\int\_0^1$$`. Đó là mất dữ liệu đang ship,
không phải thiếu renderer. Phát hiện bằng một probe 12 ca chạy qua `harness/editor.ts`
TRƯỚC khi viết dòng spec đầu tiên, cùng cách sóng 7 làm với #84. Tỉ lệ luỹ kế giữ ở 10 trên
28 ticket giao đi: cả bốn thân ticket con của sóng 8 đều đúng, vì cả bốn đều được đo lại.

**Kiểm worker bằng phép đo CỦA MÌNH, và phép đo của mình sai hai lần.** Cả bốn worker đều
được kiểm bằng probe độc lập chứ không đọc seam của họ: ca `kbd-in-link` thật sự khỏi, bug
math thật sự khỏi, fixture `math-passthrough.md` thật sự đỏ trên develop và xanh trên nhánh.
Nhưng hai phép đo của tôi sai: một lần `grep -c` đếm 0 ca đỏ trong khi seam đỏ thật (pattern
sai), một lần grep khối mã trong báo cáo báo 26 dòng "bịa" mà phần lớn là output lệnh. Cả
hai lần nghi phép đo của mình trước là đúng.

**Check mới đỏ lần đầu vì phép đo, lần thứ ba liên tiếp trong harness này.** Probe drag
handle hover vào `.tiptap p` đầu tiên và báo `hoveredAt=435,-526`: các probe chạy trước đã
cuộn tài liệu, đoạn văn đó nằm trên khung nhìn, con trỏ không đi đâu cả. Mã sản phẩm đúng.
Luật cũ của repo ("hover cần mousemove với toạ độ trong rect") vẫn đúng nhưng chưa đủ:
**toạ độ trong rect của một phần tử ngoài khung nhìn là toạ độ âm.**

**GIẢI XUNG ĐỘT CSS KIỂU "GIỮ CẢ HAI" LÀM RƠI MỘT DẤU `}`, VÀ KHÔNG GÌ BÁO.** Bốn nhánh
sóng 8 đều append vào cuối `src/webview/editor.css`, nên `editor.css` xung đột hai lần.
Tôi giải bằng cách xoá ba dòng marker và giữ cả hai bên, kiểm "có selector đầy đủ nào bị
định nghĩa hai lần không" rồi commit. Sót một dấu `}` của `.footnote-tooltip`.

Hậu quả không phải là lỗi cú pháp: **CSS lồng nhau là hợp lệ**, nên esbuild build sạch,
`npm run build`, `npm test`, `npm run roundtrip` đều xanh, và toàn bộ CSS của W3 lẫn W4 sau
điểm đó lặng lẽ trở thành rule LỒNG. `body.focus-mode #toolbar` thực chất là
`.footnote-tooltip body.focus-mode #toolbar`, không khớp gì cả. Focus mode ra mắt mà không
ẩn nổi toolbar.

Hai điều rút ra, cả hai rẻ:

```
# chốt chặn mười giây, chạy TRƯỚC mỗi commit merge có đụng một file CSS
python3 -c "s=open('src/webview/editor.css').read(); print(s.count('{'), s.count('}'))"
# hai con số phải bằng nhau
```

Và: **đừng nhận một check xanh nhờ nửa điều kiện dễ.** Bản đầu của check focus mode là
`bodyFlag || toolbarHidden`, và riêng cờ trên `body` đã đủ làm nó xanh trong khi chrome vẫn
nằm nguyên trên màn hình. Chỉ khi ép nó khẳng định đúng cái chrome, nó mới đỏ và mới lộ ra
bug. Một check có răng theo phép thử "phá cơ chế thì đỏ" VẪN có thể mù với chính thứ nó
mang tên, nếu điều kiện của nó là một phép OR có nhánh rẻ tiền.

Chẩn đoán cũng đáng giữ lại: dòng detail của check nay in `matchesRule=` và `sheetRules=`.
Một rule KHÔNG ÁP và một rule KHÔNG CÓ trông giống hệt nhau từ phía `getComputedStyle`, và
hai trường đó tách được chúng ra. Lưu ý `sheetRules` có thể bằng 0 chỉ vì webview chặn đọc
`cssRules` của stylesheet, nên đọc nó cùng `matchesRule`, đừng đọc một mình.

**Phá bốn cơ chế cùng lúc là phép thử răng rẻ hơn bốn lượt.** Một lượt floor check cho ra
5 đỏ trên 40, và con số 5 chứ không phải 4 mới là thứ đáng giá: check cũ
`an image with a width` cũng đỏ, vì gỡ whitelist HTML thì `<details>` và `<kbd>` quay về
làm raw-HTML badge và nó đếm badge. Một ràng buộc ngầm giữa check cũ và nội dung
`sample.md`, ghi lại thay vì để người sau tự vấp.

## Ràng buộc bắt buộc đưa vào spec mọi worker

1. Cấm sửa MỌI `.md` ở GỐC repo, không riêng `CHANGELOG.md` và `AGENTS.md`:
   `README.md`, `CONTEXT.md`, `CLAUDE.md` cũng vậy. Lý do kép: nhiều nhánh song
   song sẽ chọi nhau, VÀ `harness/corpus.ts` quét mọi `*.md` ở gốc làm corpus nên
   mỗi lần sửa là một golden đổi. Sóng 4 có ba issue cùng muốn sửa `README.md`.
   Bắt worker viết sẵn câu chữ vào báo cáo, điều phối viên tự áp dụng sau merge.
2. Cấm tạo file `.md` mới ở gốc worktree.
3. Cấm mở issue upstream. Thay bằng báo cáo trong `docs/upstream/<pkg>-<số>.md`,
   theo tiền lệ `3372ad2`.
4. Cấm thêm seam mới vào harness. Nhiều nhánh cùng thêm seam là chắc chắn đụng.
   Fixture mới thì được.
5. Nêu rõ ranh giới SỞ HỮU theo HÀM, không theo file. Mọi worker đều sẽ sửa
   `src/webview/main.ts` và `harness/editor.ts`, đụng file là không tránh được.
6. Nhắc `harness/editor.ts` là bản gương của `initEditor()`, sửa một bên phải
   sửa bên kia cùng lúc.
7. Bắt commit sớm, cấm `git add -A`.
8. Ghi rõ số fixture failed ở vòng hai hiện tại (nay là 0, `#109` đã chữa) để
   worker không tưởng mình làm hỏng. Con số này là bằng chứng rẻ nhất về việc
   một worker có phá vỡ gì không, nên hãy đo nó lúc máy rảnh NGAY TRƯỚC khi phóng
   và dán vào spec.
9. `npm run verify:vscode-floor` nay chạy song song được (`#110` đã sửa ở sóng 5),
   không cần cấm nữa. Nhưng nó cần MỘT CỬA SỔ VS CODE THẬT mở ra rồi đóng lại
   trên màn hình, mỗi lượt khoảng 90 giây. Bốn worker cùng chạy là bốn cửa sổ
   nhảy lên máy người dùng. Hãy nói trong spec worker được chạy nó lúc nào,
   đừng để mỗi lần build xong lại chạy một lượt.
10. Với mọi fixture, unit test hay check mới: bắt worker chứng minh bằng cách phá
    thứ nó phủ rồi dán output CẢ HAI lần, và bắt báo BAO NHIÊU ca đỏ. "Xanh" không
    phải bằng chứng; "phá thì đỏ" mới là.
11. Nói thẳng: "gửi `ask` xong thì làm tiếp phần khác, ĐỪNG gửi `worker_done`
    trước khi nhận được trả lời cho câu đã hỏi". Xem mục bẫy.
12. Khi issue đòi sửa `.md` ở gốc (và nó hay đòi), nói luôn rằng ràng buộc 1
    THẮNG tiêu chí đó, và bắt worker viết sẵn CÂU CHỮ vào báo cáo. Sóng 5 cả hai
    worker đều làm đúng nhờ câu này.

## Quy trình merge cho sóng SONG SONG

Kiểm trên nhánh là kiểm với nền đã cũ, nên phải:

Thứ tự merge có ý nghĩa. Sóng 4 đưa nhánh giao thức message (`#87`) vào trước,
vì sau đó mọi lệch lạc giữa host và webview của ba nhánh còn lại trở thành lỗi
`tsc` chứ không phải lỗi chạy.

```
1. trong worktree của nhánh:  git merge develop
2. GIẢI XUNG ĐỘT TẠI ĐÂY, điều phối viên tự làm, không đẩy cho worker
   Xung đột ở main.ts và harness/editor.ts là CHẮC CHẮN từ lần merge thứ 2.
   Sóng 3 cả hai lần đều chỉ là khối import, giải bằng hợp cả hai ý.
   Sóng 4 có ba xung đột, đều tầm thường và đều giải bằng HỢP CẢ HAI: một khối
   import ở main.ts, và hai khối tuỳ chọn `StarterKit.configure` (`underline:
   false` chọi `orderedList: false`) ở main.ts và harness/editor.ts. Chưa lần nào
   xung đột chạm vào logic. Nếu gặp xung đột logic thật thì ranh giới sở hữu
   trong spec đã sai, quay lại sửa cách chia việc chứ đừng gắng giải.
3. chạy 4 lệnh + vòng hai TRÊN NHÁNH đã merge
4. fast-forward develop
5. chạy lại 4 lệnh + vòng hai TRÊN DEVELOP
6. gh issue close <n> --comment kèm bằng chứng CỦA MÌNH, không phải của worker
```

Sau khi điều phối viên sửa `CHANGELOG.md` hoặc `AGENTS.md`, hai golden
`harness/golden/repo/` tương ứng sẽ ĐỎ. Chạy `npm run roundtrip:update`, rồi
kiểm là CHỈ hai file đó đổi. Tiền lệ `ad2b67b`.

## DỰNG SẴN SEAM RỖNG TRƯỚC KHI CẮT WORKTREE, bài học lớn nhất của sóng 7

Ràng buộc 4 cấm worker thêm seam, vì `harness/roundtrip.ts` là một file mà bốn nhánh
sẽ cùng sửa. Nhưng sóng 7 có bốn tính năng đều cần seam, nên lệnh cấm đó sẽ giết luôn
việc đo. Cách gỡ: điều phối viên commit sẵn NĂM file seam RỖNG kèm dòng đăng ký trong
`harness/roundtrip.ts`, TRƯỚC khi cắt worktree.

```
harness/slash-seam.ts        -> W1
harness/replace-seam.ts      -> W1
harness/link-edit-seam.ts    -> W2
harness/table-align-seam.ts  -> W3
harness/img-width-seam.ts    -> W3
```

Mỗi seam rỗng trả một dòng placeholder và có golden của nó, nên nền vẫn xanh
(51/0 thay cho 46/0). Worker chỉ thay ruột file của mình và golden của mình.

Kết quả: bốn nhánh, không một xung đột nào ở `harness/`, không ai chạm `roundtrip.ts`.

Làm cùng lúc một việc thứ hai cùng loại: `esbuild.harness.config.js` từng LIỆT KÊ
entry point của unit test, nên mỗi worker thêm test là một lần sửa file dùng chung.
Nay nó tự quét `test/*.test.ts`. Cùng một bệnh, cùng một cách chữa: bỏ danh sách viết
tay, để máy tự tìm.

Lưu ý ranh giới của bài học này: lưới của sóng 5 là đo RĂNG TRƯỚC trên mã chưa refactor.
Cách đó KHÔNG chuyển sang sóng 7 được, vì hành vi chưa tồn tại thì không có gì để đo
trước. Thứ chuyển được là dọn chỗ ĐỤNG NHAU, không phải dựng mốc.

## SÓNG 7: TỰ ĐO TRƯỚC KHI GIAO, VÀ NÓ TÌM RA MỘT BUG KHÔNG AI BÁO

Trước khi mở mười ticket con, điều phối viên dựng một probe nhỏ (một entry esbuild
dùng lại `roundtripMarkdown` của `harness/editor.ts`, để trong scratchpad) và chạy
thẳng các hình dạng markdown mà `#84` nói tới. Nó trả về ba thứ, theo thứ tự giá trị
tăng dần:

1. Xác nhận `#84` sai chiều về `<img width>`: giữ được, nhưng đi qua `rawHtmlInline`
   và render ra `<pre><code>` kèm badge. Làm theo lời issue là biến ảnh thành mã nguồn.
2. Dự đoán chính xác golden nào sẽ đổi vì `#120`, để sau đó có cái đối chiếu với worker.
3. **Một lỗi MẤT DỮ LIỆU chưa ai báo**: `[<img src="a.png" width="200">](https://x)`
   roundtrip ra `<img src="a.png" width="200">`, link biến mất hẳn. Mở thành `#124`,
   giao kèm `#120` như một ca răng CÓ ĐÁP ÁN BIẾT TRƯỚC, và nó xanh sau bản vá.

Mục 3 là thứ đáng nhân rộng. Một ca răng do worker tự nghĩ ra thì đáp án cũng do nó
đặt; một ca răng do điều phối viên đo được trước thì đáp án đến từ thực tế. Sóng sau
nên dành ra ba mươi phút dựng probe trước khi viết ticket.

## LỖI CỦA ĐIỀU PHỐI VIÊN SÓNG 7, đừng lặp lại

**Hai lần liên tiếp tôi tự làm cùn phép thử răng của mình, trên cùng một worker.**

Lần một, đo seam `table-align`: tôi `git checkout ac7ed69 -- table-context-menu.ts`,
tức HOÀN NGUYÊN NGUYÊN FILE. Export biến mất, seam không biên dịch được,
`roundtrip:update` chết trước khi ghi, `git diff` báo 0 dòng đổi. Tôi suýt kết luận
seam không có răng. Đo lại bằng cách giữ chữ ký và làm rỗng ruột hàm: 16 trên 63 dòng.
**Phép thử răng phải LÀM SAI một hàm, không phải LÀM BIẾN MẤT nó.**

Lần hai, đo fixture `image-resize.md` của `#120`: tôi chỉ hoàn nguyên `raw-html.ts`,
và fixture vẫn XANH, nên tôi suýt gọi nó là fixture rỗng ruột. Bản vá nằm ở HAI file;
phần chữa link sống trong `markdown-destination.ts`. Hoàn nguyên cả ba file thì đúng
một dòng đỏ, và nó là ca `#124`. **Hoàn nguyên một nửa một bản vá là một phép thử răng
cùn mà trông vẫn sắc**, đúng họ với bài học "ép đúng điều kiện, và ép cho đúng lúc"
của sóng 6.

**Dự đoán golden của tôi sai ở KẾT LUẬN dù đúng ở CƠ CHẾ.** Tôi đo trước và nói
`golden/synthetic/raw-html.md` SẼ đổi vì dòng `<img src="a.png" width="200">` chuyển
từ `rawHtmlInline` sang node Image. Nó không đổi. Golden ghi lại CHUỖI, mà
`MarkdownImage.renderMarkdown` mới viết ra đúng chuỗi cũ. Node đổi, byte không đổi.
Worker đúng, tôi sai. Hai dự đoán kia thì đúng, và chúng cứu thời gian thật.

Bài học: khi dự đoán một golden, hỏi "thứ file này GHI LẠI có đổi không", đừng hỏi
"thứ tôi vừa sửa có đổi không".

**Suýt quên `npm install` sau khi merge nhánh có dependency mới.** `node_modules` của
mỗi worktree là bản clone APFS từ repo gốc, nên repo GỐC không tự có gói mới. Fast-forward
`develop` qua nhánh W2 rồi chạy `npm run build` ngay là đỏ, và `tsc` chưa chắc bắt.
Đưa bước này vào sổ tay merge từ lúc chia việc, không phải lúc gặp.

## Cái ĐÃ CHẠY của sóng 7, giữ lại

**Đọc hộp thư ngay sau khi phóng, và nó cứu đúng cái sóng 5 đã mất.** W4 gửi một câu
`ask` thật về `#122` lúc 13:52Z. Tôi đang ở trong `check --wait` nên đọc được ngay, trả
lời, và commit của W4 lúc 13:59Z làm đúng theo phương án đã trả lời. Sóng 5 mất trọn một
vòng vì chuyện ngược lại.

**Sửa thân issue TRƯỚC khi giao, thay vì để worker phát hiện.** `#84` sai cơ chế ở bảy
chỗ: không có node `pageBreak`; `aria-expanded` đã được set từ `d314324`; `setState`
sai kho vì không có `retainContextWhenHidden`; wiki link không "does nothing" mà có
toast; tiền đề `<img width>` ngược chiều; việc giữ alignment đã ship ở 2.16; và hai
phần ba mục toolbar active state đã có sẵn. Cả bảy đều được đo lại và viết thẳng vào
thân ticket con, nên không worker nào mất một vòng nào vì chúng. Sóng 4 chép nguyên câu
sai vào spec hai lần và phải trả giá; sóng 7 thì không.

**Xung đột merge lại chỉ là một khối import.** Lần thứ tư liên tiếp. Giải bằng hợp cả
hai. Ranh giới sở hữu theo HÀM, không theo file, tiếp tục đúng: W1, W2, W4 cùng sửa
`src/webview/main.ts` và `src/markdownEditorProvider.ts` mà ba lần merge đầu không đụng
nhau một dòng nào.

**Một worker vi phạm ranh giới và nó ĐÚNG.** W2 bị cấm chạm `harness/editor.ts` (chỉ W3
được), nhưng nó đổi `MarkdownImage` sang `inline: true` ở CẢ `main.ts` LẪN
`harness/editor.ts`. Vi phạm chữ, giữ đúng nghĩa: lệnh cấm sinh ra để tránh đụng nhau,
còn ràng buộc 6 thì bắt sửa hai bên cùng lúc. Sóng sau nên viết rõ trong spec rằng ràng
buộc 6 THẮNG lệnh cấm file, thay vì bắt worker tự đoán.

**Tương tác giữa hai nhánh chỉ lộ ra ở bước merge, và quy trình bắt được nó.**
`inline: true` của W2 gặp slash command của W1 lần đầu lúc merge nhánh cuối, làm đỏ
`seams/slash.txt`: `node=image` thành `node=paragraph`. Phân loại accepted change, vì
trong CommonMark ảnh là inline. Thứ chứng minh nó an toàn không phải dòng golden đó mà
là 40 fixture KHÔNG đổi. Nếu chạy kiểm chỉ trên từng nhánh rồi merge mù, dòng này đã
vào repo mà không ai phân loại.

Bản `COMMON.md` sóng 7 phát cho mỗi worker nằm ở `docs/agents/wave-worker-brief.md`,
đã bỏ phần riêng của sóng. Copy nó vào worktree thay vì viết lại: bản gốc từng chỉ tồn
tại trong bốn worktree và suýt mất khi dọn.

## Còn treo sau sóng 7

Mục này gắn với một thời điểm, không phải quy trình. Kiểm lại trước khi tin.

Bản đầu của mục này liệt kê sáu món nợ. Điều phối viên đã xử một lượt ngay sau đó,
và lượt xử ấy tìm ra một lỗi nặng hơn tất cả sáu món cộng lại, nên phần dưới ghi cả
cái đã trả lẫn cái vừa lộ ra.

### Đã trả

- **Bảy tiêu chí kiểm TAY đã thành check floor tự động.** `driveSurfaces`
  trong `harness/vscode-floor/run.mjs` nay gõ `/` và đọc menu slash, mở find-and-replace
  và thay một từ, bôi đen rồi đọc bubble menu, kéo tay cầm resize ảnh rồi đọc lại
  chiều rộng đã ghi, mở lightbox và đóng bằng Escape, rê chuột lên heading để lấy nút
  copy anchor (nút này sau đó bị GỠ theo yêu cầu, xem CHANGELOG), và đọc dòng reading time. Răng đo theo hai mẻ, đúng 3 và đúng 4 dòng đỏ
  khi gỡ đúng phần code tương ứng. Floor đi từ 20 lên 29 check. (Con số "mười bốn" của
  bản trước là cộng nhẩm sai: liệt kê ra thì nó là 17. Danh sách dưới đây đếm lại.)
- **Ba trong bảy probe đó TỐ OAN code đang chạy đúng trước khi chúng đúng.** Ghi lại vì
  phần sửa đáng giá hơn phần probe: NodeView của ảnh ghi `style.width` chứ không ghi
  thuộc tính `width`; overlay hiện khi hover cần một `mousemove` mang toạ độ NẰM TRONG
  rect của đích, không phải `mouseover` lên phần tử; và `defaultPrevented` trên một
  `contextmenu` không chứng minh gì cả, vì webview của VS Code tự huỷ sự kiện đó. Một
  range selection đặt bằng script cũng không tới được ProseMirror, nên thứ gì đọc
  selection của editor thì phải lái QUA editor.
- **`#122` nay đã chứng minh được một nửa.** Check floor mở sample theo đường thường,
  không viewType, dưới ba trạng thái của `workbench.editorAssociations` và đọc lại
  editor nào thắng. Răng: đặt `contributes.customEditors` về `priority: "option"` làm
  nó đỏ đúng ở trạng thái đầu.
- **Ca resize ảnh inline mà không worker nào từng thấy: đã có check.** Nó nằm trong mẻ
  bảy probe trên, và chính việc thêm ảnh vào `sample.md` để dựng probe ấy là thứ làm
  lộ lỗi mount dưới đây.

### Vừa lộ ra khi trả nợ

- **Lỗi nặng nhất của sóng 7 không phải do worker nào gây ra, và không có lưới nào bắt
  được nó ngoài floor.** `MarkdownImage` lật sang `inline: true` (`#117` cần thế để đặt
  link mark). Nhưng `parseMarkdown` của `@tiptap/extension-paragraph` trả về CHÍNH cái
  ảnh cho một paragraph chỉ chứa ảnh, bỏ luôn paragraph: đúng với ảnh block, sai với ảnh
  inline, và dựng ra `doc > image` mà schema không cho phép. Tiptap ném
  `Called contentMatchAt on a node with invalid content` ngay lúc construct: editor
  không mount, UI không báo gì, panel trắng cho BẤT KỲ file nào có một `![](...)` đứng
  riêng dòng. Đây là lập luận mạnh nhất cho việc giữ check floor: với lỗi đang có,
  `npm run roundtrip` báo **52 passed 0 failed**, vì nó đo một chuỗi qua một editor nó
  tự dựng sai y hệt; `verify:vscode-floor` báo **6 fail**.
- **Hai bản sửa GIẢ đã bị đo và loại trên đường tới bản thật**, cả hai đều xanh khi
  test răng nếu không cẩn thận. Một, đọc cờ từ `this.editor`: `this.editor` là
  `undefined` trong lần parse ĐẦU, nên `?? true` mặc định sai và luật không bao giờ
  chạy ở chỗ cần. Hai, `return null` ở nhánh fallback: nó rơi xuống
  `parseFallbackToken` của chính manager, cái này lại bọc paragraph ĐÚNG, nên override
  trông như có tác dụng trong khi nó không làm gì. Bản thật bắt và gọi lại
  `Paragraph.config.parseMarkdown` đã chụp từ trước, và cờ là hằng số module
  `IMAGE_IS_INLINE`.
- **`#125`: mỗi ảnh render kèm một `<img>` rỗng thứ hai.** Tìm ra từ dòng detail của
  một check floor (`images=4` khi sample chỉ có 2 ảnh), không phải từ báo cáo người
  dùng. Đo tiếp thì nó KHÔNG phải node nhân đôi: đó là `img.ProseMirror-separator` của
  chính prosemirror-view, chèn cạnh một leaf node trong trình duyệt thật nhưng không
  chèn dưới jsdom. Đã đóng: sửa cache hover của `image-edit-plugin.ts` cho khỏi đi qua
  chúng, và check floor nay khẳng định mỗi ảnh đúng một phần tử thật. Bài học là dòng
  detail mang SỐ ĐẾM đáng giá hơn dòng detail chỉ mang pass/fail.

### Còn treo

- **Số tiêu chí còn phải kiểm tay: xem `docs/manual-checks.md`, ĐỪNG chép lại con số
  vào đây.** Nó đã sai ba lần: bản đầu viết 14 trong khi liệt kê ra 17, rồi lượt đi
  kiểm thật cho thấy 5 mục lái được bằng máy và nay là check floor. Một con số chép ở
  bốn chỗ là bốn chỗ sẽ lệch nhau.
- **Lượt kiểm tay thật tìm ra 3 lỗi nữa và làm GỠ một tính năng.** `#121` (nhớ vị trí
  con trỏ) bị gỡ ngay trong chu kỳ dựng ra nó, sau khi đã sửa hai lỗi thật trong nó mà
  người dùng vẫn thấy y như cũ. Cái họ báo là "mất trỏ", và nguyên nhân là chưa bao
  giờ có gì focus editor, không liên quan tới vị trí. Bài học: **triệu chứng báo lên và
  cơ chế hỏng có thể không dính gì tới nhau**, nên đừng sửa cái mình đoán, hãy hỏi lại
  người dùng thấy gì.
- **Lượt trả nợ ấy tìm ra hai lỗi đang ship, không phải bằng cách đọc mã.** DOCX export
  chết trên chính phiên bản `engines.vscode` hứa (`crypto is not defined`, Node 18 chưa
  có Web Crypto global), và lightbox không bẫy được tiêu điểm trong cửa sổ bị che (đúng
  cơ chế `#112`, lần thứ hai). Bài học: **món nợ lưới là món trả trước.**
- **Menu chuột phải trên bảng là ca floor chịu thua rõ nhất.** Ba lần thử: range
  selection đặt bằng script không sync vào ProseMirror; click qua CDP dùng toạ độ
  trang chứ không phải toạ độ iframe; và `defaultPrevented` không phải bằng chứng vì
  webview của VS Code tự huỷ `contextmenu`. Ghi lại để sóng sau không đo lại ba lần.
- **`#124` đã đóng hẳn, nửa thẻ đôi đóng dạng `wontfix`.** Ghi lại ở đây vì đây là
  kiểu quyết định dễ bị sóng sau mở lại: nguyên nhân nằm ở UPSTREAM, serializer của
  `@tiptap/markdown` đóng mọi mark trước một node không phải text rồi mở lại sau nó,
  nên một mark không bao giờ bọc được một atom. Đầu ra hiện tại lossless, và cả ba cách
  vá đã đo đều đánh đổi tính lossless hoặc đánh đổi cú pháp của chính người dùng. Đo
  nằm trong `docs/upstream/tiptap-markdown-mark-around-atom.md`. Muốn sửa thì mở issue
  MỚI nói rõ nhận đánh đổi nào, đừng mở lại `#124` như một bug thường.
- **`#48` vẫn mở về bản chất.** `#122` chữa việc MỞ file, và điều đó nay có bằng chứng.
  Diff editor của Git Graph thì chưa ai cài, bấm vào một commit và xem kết quả.
- `#96` còn hai tiêu chí hành vi editor chưa kiểm được bằng harness.
- `src/webview/main.ts` nay là file lớn nhất của repo. Sóng sau thêm tính năng
  webview thì nên tách theo nhóm, y như `#88` đã làm với provider.
- Sáu run orchestration cũ còn trong Orca: `run_c607755eea03` (sóng 2),
  `run_81e972296c40` (sóng 3), `run_7c86994cae6d` (sóng 4), `run_03c8c7760738`
  (sóng 5), `run_2f8d1bbc233e` (sóng 7). CỐ Ý KHÔNG chạy `orca orchestration reset`
  vì lệnh đó không có cờ `--run`, nó xoá state TOÀN CỤC và sẽ đụng các dự án khác.
- `develop` CHƯA push.

## Sóng 8 nên làm gì

Không phải code trước. Việc lớn nhất là **một lượt kiểm tay mười bốn tiêu chí còn lại**,
và nó cần một con người ngồi trước cửa sổ VS Code chứ không cần một sóng worker. Sau đó
là quyết định về nửa còn lại của `#124`, và đó là một quyết định đánh đổi chứ không phải
một việc code: ba cách vá đều đã đo, xem `docs/upstream/tiptap-markdown-mark-around-atom.md`.

Và một bài học của sóng này đáng đem sang sóng sau: **món nợ lưới là món trả trước, không
phải trả sau.** Sáu món nợ ghi ở trên trả hết trong một lượt, nhưng cái lượt ấy tìm ra một
lỗi làm editor không mount cho mọi file có ảnh, tức là nếu 2.17 phát hành đúng lúc kết sóng
thì nó đã phát hành kèm lỗi đó. Lưới không bắt được lỗi mình chưa dựng.

`#85` (Release 3.0: Beyond GFM) là việc tiếp theo có thể phóng worker.

## Ảnh chụp trạng thái cuối sóng 7, 2026-09-17

Giữ lại làm ví dụ về mức độ chi tiết một bàn giao nên có. Số liệu bên dưới ĐÃ CŨ
ngay khi có commit tiếp theo; kiểm lại bằng git và `gh issue list`.

```
worktree sóng 7    đã xoá cả bốn (1.7 GB), cùng bốn mục trong `trustedWorkspaces`
develop            xem `git log`, CHƯA push
lint, build        xanh
npm test           54 passed, 0 failed          <- 35 trước sóng
roundtrip          40 fixtures + 12 seams: 52 passed, 0 failed   <- 39 + 7 = 46 trước sóng
vòng hai           52 passed, 0 failed
verify:vscode-floor 29/29                       <- 20 lúc kết sóng, 9 check trả nợ thêm sau
package.json       2.17.0
issue mở           2: #85, #126
```

Sóng 7 đóng `#114` tới `#124` cộng `#84`, bốn worker `agy`, bốn worktree, một xung đột
merge duy nhất và nó là khối import. Bug tìm thêm được trong lúc đo: ba, và không cái nào
do người dùng báo. `#124` mất dữ liệu thật, tìm ra lúc đo bán kính ảnh hưởng của `#120`.
Lỗi mount, nặng nhất, tìm ra lúc trả nợ lưới. `#125` tìm ra từ một dòng detail của check
vừa thêm. Cả ba đều tới từ việc ĐO, không từ việc đọc báo cáo worker.
