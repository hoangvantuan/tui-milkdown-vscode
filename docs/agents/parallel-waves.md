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
thành 8 trên 26. Sóng 6 thêm hai, thành 10 trên 28, và cả hai lần thân issue
sai ở CƠ CHẾ chứ không ở triệu chứng: `#111` trỏ vào cái guard (`isUpdatingFromExtension`) trong khi nguyên nhân là `trailingNode` của StarterKit, `#112`
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

## Còn treo sau sóng 6

Mục này gắn với một thời điểm, không phải quy trình. Kiểm lại trước khi tin.

- **`#112` đã đóng, nhưng đọc lại nó để thấy một thân issue sai tới mức nào.**
  Tiêu đề nói "cửa sổ dò 40 giây quá ngắn dưới tải". Thực tế không liên quan tới
  tải lẫn ngân sách: `mermaid-plugin.ts` lên lịch render lần đầu trong một
  `requestAnimationFrame`, cửa sổ ẩn thì rAF không chạy, nên không có lịch nào.
  Nay lịch do rAF hoặc một timer 50ms, cái nào tới trước thì thắng.
- **Một tài nguyên dùng chung mà `#110` không phủ**: mỗi lượt
  `verify:vscode-floor` chạy `npm run build` ghi vào `out/` của chính repo, và
  VS Code nạp extension từ đường dẫn repo. Hai lượt song song ghi đè bundle của
  nhau. Artifact cụt cho `errors=1` chứ không phải `errors=0 stuck=1` nên nó
  không phải `#112`, nhưng câu "hai lượt chạy cùng lúc được" chỉ đúng vì một
  checkout build ra cùng bytes. Đã ghi vào header `run.mjs`, chưa sửa.
- **Sáu tiêu chí kiểm tay của `#88` chưa ai kiểm**, đều cần một cửa sổ VS Code
  sống: dán ảnh, đổi tên ảnh, xoá ảnh, export DOCX, export PDF, `@` mention và
  `[[` wiki link. Ghi ở `docs/reports/w5-provider.md` mục 10.
- **Bốn tiêu chí kiểm tay của sóng 4 vẫn chưa ai kiểm**: ép lỗi clipboard
  (`#105`), gõ rồi Ctrl+W mười lần (`#104`), ảnh chụp trước/sau hai theme
  (`#86`), Keyboard Shortcuts liệt kê hai lệnh (`#108`). Nên làm một lượt bằng
  tay trước khi phát hành.
- `#102` vẫn còn bước kiểm TAY từ sóng 3: đổi `editor.tabSize` rồi xem lần sửa
  sau có ghi ra thụt lề mới không. Quy trình ở `docs/reports/w4-indent.md` mục 7.
- `#96` còn hai tiêu chí hành vi editor chưa kiểm được bằng harness.
- `src/host/messageHandlers.ts` 301 dòng là file lớn nhất dưới `src/host/`.
  Sóng sau thêm message thì nên tách theo nhóm.
- Năm run orchestration cũ còn trong Orca: `run_c607755eea03` (sóng 2),
  `run_81e972296c40` (sóng 3), `run_7c86994cae6d` (sóng 4), `run_03c8c7760738`
  (sóng 5). Sóng 6 không tạo run nào. CỐ Ý KHÔNG chạy
  `orca orchestration reset` vì lệnh đó không có cờ `--run`, nó xoá state TOÀN
  CỤC và sẽ đụng các dự án khác của người dùng.
- Hai worktree của sóng 5 (`w5-unittests`, `w5-provider`) đã merge hết vào
  `develop`. Xoá được bằng `orca worktree rm`, cùng với mục `w5-unittests` trong
  `trustedWorkspaces` của `~/.gemini/antigravity-cli/settings.json`.
- Ba nhánh local của sóng 6 đã fast-forward vào `develop` và đã xoá. `develop`
  CHƯA push, và lịch sử của nó ĐÃ ĐƯỢC VIẾT LẠI một lần bằng `git filter-branch`
  để bỏ gạch dài khỏi ba commit message, nên mọi SHA của sóng này khác với SHA
  từng xuất hiện ở đâu đó trước lúc viết lại.

## Sóng 7 nên làm gì

Release 2.16 (`#83`) đã đóng hết issue con. Việc còn lại của nó là mười tiêu
chí kiểm tay ở trên, không phải code. `#111` hoá ra đúng là bug sản phẩm chứ
không chỉ bug harness, đúng như dự đoán của sóng 5.

Sau đó là `#84` (Release 2.17), mà thân issue nói rõ mỗi mục chỉ thành issue khi
2.16 xong. Giờ nó xong rồi. Nền đã sẵn: `#90` cho slash command, `#87` cho
giao thức message, và nay `#88` cho bảng dispatch, nên mỗi tính năng mới của
2.17 là thêm một entry vào một bảng được `tsc` khoá chứ không phải thêm một
nhánh vào một `switch` 780 dòng.

## Sóng 6 không phóng worker nào, và đó là quyết định đúng

Đáng ghi vì playbook này viết ra để phóng worker, và lần này luật của chính nó
bảo đừng.

Kế hoạch ban đầu: điều phối viên tự làm `#112` (nó và `#111` cùng sửa
`run.mjs`, và nghiệm thu `#112` cần ba cửa sổ VS Code cùng lúc, sẽ làm worker
`#111` đỏ giả), rồi phóng một worker cho `#111`. Đo xong `#112` thì tình hình
đổi: nó không tái hiện được, phần giao được chỉ còn là thước đo, và toàn bộ
mạch suy luận về `#111` (cơ chế, hình dạng lời giải, lưới đã đỏ) đã nằm trong
đầu điều phối viên. Chuyển giao qua spec là chép lại gần hết những gì vừa đo,
để nhận về một vòng hỏi đáp. Đúng điều kiện "spawn cost outweighs benefit".

Cái KHÔNG bỏ là kỷ luật: vẫn dựng lưới trước khi sửa, vẫn commit một check ĐỎ
có chủ đích trước khi viết bản vá, vẫn đo răng từng nửa của lời giải riêng rẽ,
vẫn đóng issue bằng bằng chứng của mình. Quy trình sóng không phải là số worker.

Một lưu ý cho sóng sau: commit một check đỏ vào `develop` chỉ an toàn vì CI
KHÔNG chạy `verify:vscode-floor` (nó cần một màn hình). Kiểm lại `ci.yml` trước
khi làm thế với một loại kiểm khác.

## Ảnh chụp trạng thái cuối sóng 6, 2026-09-16

Giữ lại làm ví dụ về mức độ chi tiết một bàn giao nên có. Số liệu bên dưới ĐÃ CŨ
ngay khi có commit tiếp theo; kiểm lại bằng git và `gh issue list`.

```
develop            xem `git log`, lịch sử đã viết lại một lần, CHƯA push
lint, build, build:dev  xanh
roundtrip          39 fixtures + 7 seams: 46 passed, 0 failed
vòng hai           46 passed, 0 failed
npm test           35 passed, 0 failed
verify:vscode-floor 20/20                     <- 19/19 trước sóng này
issue mở           3: #83 #84 #85, cả ba là issue mẹ
```

Sóng 6 đóng `#111` và `#112`, không worker nào, mười commit. Cả hai ticket đều
sai CƠ CHẾ trong thân issue, và cả hai lần thứ tìm ra nguyên nhân là một phép
đo chứ không phải một lần đọc mã: `#111` lộ ra khi log chỗ gửi edit
(`len 378->379`, đúng một ký tự xuống dòng), `#112` lộ ra khi thêm `scheduled=`
vào dòng detail rồi đợi lần đỏ kế tiếp.

Hai trên hai ticket của sóng này sai CƠ CHẾ trong thân issue. Tỉ lệ luỹ kế:
10 trên 28.
