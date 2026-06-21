const imageInput = document.getElementById('imageInput');
const previewImage = document.getElementById('previewImage');
const uploadArea = document.getElementById('uploadArea');
const ocrButton = document.getElementById('ocrButton');
const resetButton = document.getElementById('resetButton');
const calendarButton = document.getElementById('calendarButton');
const copyTextButton = document.getElementById('copyTextButton');
const status = document.getElementById('status');
const ocrText = document.getElementById('ocrText');

const titleInput = document.getElementById('titleInput');
const dateInput = document.getElementById('dateInput');
const startTimeInput = document.getElementById('startTimeInput');
const endTimeInput = document.getElementById('endTimeInput');
const locationInput = document.getElementById('locationInput');
const detailsInput = document.getElementById('detailsInput');

let currentImageFile = null;

function setStatus(message, isError = false) {
  status.textContent = message;
  status.style.color = isError ? '#d9534f' : '#6b7280';
}

function resetForm() {
  imageInput.value = '';
  previewImage.removeAttribute('src');
  previewImage.style.display = 'none';
  ocrText.value = '';
  titleInput.value = '';
  dateInput.value = '';
  startTimeInput.value = '';
  endTimeInput.value = '';
  locationInput.value = '';
  detailsInput.value = '';
  currentImageFile = null;
  setStatus('画像を選んでください。');
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('画像の読み込みに失敗しました。'));
    reader.readAsDataURL(file);
  });
}

function formatDateForInput(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// 2桁年を西暦に変換する（70未満は2000年代、それ以外は1900年代）
function normalizeYear(yearText) {
  if (yearText.length === 2) {
    const value = Number(yearText);
    return value < 70 ? 2000 + value : 1900 + value;
  }
  return Number(yearText);
}

// 範囲が妥当ならDateを返す。不正な月日ならnull
function buildDate(year, month, day) {
  if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
    return new Date(year, month - 1, day);
  }
  return null;
}

function parseDateLikeText(text) {
  // YYYY/MM/DD・YYYY年MM月DD日 形式（年が先頭）
  const yearFirst = text.match(/(\d{4})[\/年-](\d{1,2})[\/月-](\d{1,2})日?/);
  if (yearFirst) {
    const date = buildDate(Number(yearFirst[1]), Number(yearFirst[2]), Number(yearFirst[3]));
    if (date) {
      return date;
    }
  }

  // M/D・M/D/YY(YY) 形式（年は末尾、省略時は今年）
  const monthFirst = text.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (monthFirst) {
    const year = monthFirst[3] ? normalizeYear(monthFirst[3]) : new Date().getFullYear();
    const date = buildDate(year, Number(monthFirst[1]), Number(monthFirst[2]));
    if (date) {
      return date;
    }
  }

  return null;
}

function parseTimeLikeText(text) {
  const timeMatch = text.match(/(\d{1,2})[:時](\d{1,2})(?:分)?/);
  if (timeMatch) {
    const hours = Number(timeMatch[1]);
    const minutes = Number(timeMatch[2]);
    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    }
  }
  return '';
}

// タイトル先頭/末尾の絵文字誤読ノイズを除去する
function stripTitleNoise(title) {
  return (
    title
      .replace(/^.{1,2}[)\]）］]/, '')       // 先頭の誤読(例:「ご]」)を除去
      .replace(/([一-鿿])[ァ-ヶー]$/, '$1') // 末尾の孤立カタカナを除去
      .trim() || 'イベント'
  );
}

const MIN_TITLE_LENGTH = 2;      // これより短い行はタイトルにしない
const MAX_TITLE_TOP_RATIO = 0.6; // タイトルは本文の上部60%以内にある前提

// 日付・時刻など、データで始まる行か判定する
function isDataLine(text) {
  return /^[\d(（]/.test(normalizeDigits(text));
}

// 文字(かな・漢字・英数字)を含むか。記号・装飾のみの行を除外する
function hasMeaningfulText(text) {
  return /[\p{L}\p{N}]/u.test(text);
}

// タイトル推定(フォント): 上部で最も大きい文字の行を選ぶ。候補がなければ空文字
function inferTitleByFont(lines) {
  if (!lines.length) {
    return '';
  }
  // 探索範囲は本文の縦スパンの上部割合で決める(1行のみでも除外しない)
  const tops = lines.map((line) => line.top);
  const minTop = Math.min(...tops);
  const maxTop = Math.max(...tops);
  const topLimit = minTop + (maxTop - minTop) * MAX_TITLE_TOP_RATIO;

  const candidates = lines.filter(
    (line) =>
      line.top <= topLimit &&
      line.text.length >= MIN_TITLE_LENGTH &&
      !isDataLine(line.text) &&
      hasMeaningfulText(line.text)
  );
  if (!candidates.length) {
    return '';
  }

  const biggest = candidates.reduce((max, line) => (line.height > max.height ? line : max));
  return stripTitleNoise(normalizeDigits(biggest.text));
}

// タイトル推定(テキスト): 上部のイベント語を優先し、無ければ最初の意味のある行
function inferTitle(text) {
  const TOP_LINES = 4; // タイトルは先頭付近にある前提
  const eventKeywords = /会議|説明会|講演|面談|打ち合わせ|セミナー|試験|発表|受付|訪問|出張|研修|ランチ会|食事会|飲み会|歓迎会|送別会|懇親会|忘年会|新年会|パーティ|ライブ|コンサート|展示|フェア|大会/;

  const top = text
    .split(/\n|\r/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, TOP_LINES);

  const candidate =
    top.find((line) => eventKeywords.test(line)) ||                            // 上部のイベント語を優先
    top.find((line) => !isDataLine(line) && line.length >= MIN_TITLE_LENGTH) || // 次に意味のある行
    top[0] ||
    'イベント';

  return stripTitleNoise(candidate);
}

function inferLocation(text) {
  const lines = text.split(/\n|\r/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    if (/会場|場所|住所|東京都|北海道|大阪|京都|福岡|県|市|ビル|ホテル|オフィス|大学|学校/i.test(line)) {
      return line;
    }
  }
  return '';
}

function inferDetails(text) {
  const lines = text.split(/\n|\r/).map((line) => line.trim()).filter(Boolean);
  const skipKeywords = /イベント|会議|説明会|講演|面談|打ち合わせ|予約|試験|発表|セミナー|会場|場所|住所|日時|時間|詳細|担当|連絡|電話/i;
  return lines.filter((line) => !skipKeywords.test(line)).slice(0, 6).join('\n');
}

function applyHeuristics(text, lines) {
  const date = parseDateLikeText(text);
  if (date) {
    dateInput.value = formatDateForInput(date);
  }

  const startTime = parseTimeLikeText(text);
  if (startTime) {
    startTimeInput.value = startTime;
  }

  const location = inferLocation(text);
  if (location) {
    locationInput.value = location;
  }

  // フォント最大の行を優先し、取れなければテキストから推定する
  titleInput.value = inferTitleByFont(lines) || inferTitle(text);

  const details = inferDetails(text);
  if (details) {
    detailsInput.value = details;
  }
}

// YYYY-MM-DD の翌日を YYYYMMDD 形式で返す
function getNextDayCompact(date) {
  const next = new Date(`${date}T00:00:00`);
  next.setDate(next.getDate() + 1);
  return formatDateForInput(next).replace(/-/g, '');
}

// Google Calendar の dates パラメータを組み立てる
function buildCalendarDates(date, startTime, endTime) {
  const compactDate = date.replace(/-/g, '');

  if (startTime) {
    const start = `${compactDate}T${startTime.replace(':', '')}00`;
    // 終了時刻が空なら開始時刻と同じにする
    const end = `${compactDate}T${(endTime || startTime).replace(':', '')}00`;
    return `${start}/${end}`;
  }

  // 終日イベントは終了日が排他的なので翌日を指定する
  return `${compactDate}/${getNextDayCompact(date)}`;
}

// データURLからImage要素を生成する
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('画像の読み込みに失敗しました。'));
    image.src = src;
  });
}

// グレースケール変換の輝度係数(ITU-R BT.601)
const LUMA_R = 0.299;
const LUMA_G = 0.587;
const LUMA_B = 0.114;

const TARGET_MIN_WIDTH = 1600; // 小さい画像は拡大して認識率を上げる
const MAX_PIXELS = 12_000_000; // 大きすぎる画像はモバイルのキャンバス上限対策で縮小する

// OCR精度を上げる前処理: 拡大/縮小・グレースケール・ヒストグラム伸張
async function preprocessImage(file) {
  const dataUrl = await readFileAsDataURL(file);
  const image = await loadImage(dataUrl);

  let scale = image.width < TARGET_MIN_WIDTH ? TARGET_MIN_WIDTH / image.width : 1;
  // 変換後のピクセル数が上限を超える場合は縮小する(空のキャンバス対策)
  if (image.width * image.height * scale * scale > MAX_PIXELS) {
    scale = Math.sqrt(MAX_PIXELS / (image.width * image.height));
  }

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(image.width * scale);
  canvas.height = Math.round(image.height * scale);

  const context = canvas.getContext('2d');
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = imageData.data;

  // グレースケール値をR成分に一時保存しつつ最小・最大の明度を求める
  let min = 255;
  let max = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const gray = pixels[i] * LUMA_R + pixels[i + 1] * LUMA_G + pixels[i + 2] * LUMA_B;
    pixels[i] = gray;
    if (gray < min) min = gray;
    if (gray > max) max = gray;
  }

  // ヒストグラムを0〜255へ伸張してコントラストを最大化する(均一画像はそのまま)
  const range = max - min;
  for (let i = 0; i < pixels.length; i += 4) {
    const gray = pixels[i];
    const value = range > 0 ? ((gray - min) / range) * 255 : gray;
    pixels[i] = pixels[i + 1] = pixels[i + 2] = value;
  }
  context.putImageData(imageData, 0, 0);

  return canvas;
}

// OCRのブロック構造から行リスト(テキスト・上端位置・高さ)を取り出す
function extractLines(blocks) {
  const lines = [];
  (blocks || []).forEach((block) => {
    (block.paragraphs || []).forEach((paragraph) => {
      (paragraph.lines || []).forEach((line) => {
        const text = line.text.trim();
        if (text) {
          lines.push({ text, top: line.bbox.y0, height: line.bbox.y1 - line.bbox.y0 });
        }
      });
    });
  });
  return lines;
}

async function runOCR(imageFile) {
  if (!imageFile) {
    throw new Error('画像が選択されていません。');
  }

  setStatus('画像を準備しています...');
  const processedImage = await preprocessImage(imageFile);

  const worker = await Tesseract.createWorker('jpn+eng', 1, {
    logger: (m) => {
      if (m.status === 'recognizing text') {
        setStatus(`OCR進行中: ${Math.round(m.progress * 100)}%`);
      }
    },
  });

  try {
    await worker.setParameters({
      tessedit_pageseg_mode: '3', // 自動レイアウト解析
      preserve_interword_spaces: '1',
    });
    const { data } = await worker.recognize(processedImage, {}, { blocks: true });
    return { text: data.text, lines: extractLines(data.blocks) };
  } finally {
    await worker.terminate();
  }
}

// 丸数字(①〜⑳)・全角数字を半角数字へ変換する
function normalizeDigits(text) {
  return text
    .replace(/[①-⑳]/g, (c) => String(c.charCodeAt(0) - 0x2460 + 1)) // ①=U+2460
    .replace(/⓪/g, '0')
    .replace(/[０-９]/g, (c) => String(c.charCodeAt(0) - 0xff10));    // 全角数字=U+FF10〜
}

// 折り返しで分断された行を連結する(タイトル・日付などの単独行は保持)
function joinWrappedLines(lines) {
  const MIN_WRAP_LENGTH = 10; // これより短い行は折り返しではなく独立した行とみなす
  const terminator = /[。．.!?！？]$/;
  const dataStart = /^[\d(（]/;

  const joined = [];
  lines.forEach((line, index) => {
    const prev = joined[joined.length - 1];
    const canJoin =
      index > 0 &&
      joined.length >= 2 &&             // 1行目(タイトル)には連結しない
      prev.length >= MIN_WRAP_LENGTH &&
      !terminator.test(prev) &&
      !dataStart.test(prev) &&
      !dataStart.test(line);
    if (canJoin) {
      joined[joined.length - 1] = prev + line;
    } else {
      joined.push(line);
    }
  });
  return joined;
}

// OCR結果を整形する: 数字の正規化・余分なスペース除去・折り返しの連結
function cleanOcrText(raw) {
  const cjk = '\\u3000-\\u303f\\u3040-\\u30ff\\u3400-\\u4dbf\\u4e00-\\u9fff\\uff00-\\uffef';
  // 後読み(?<=)は古いSafariで未対応のため、キャプチャグループで代用する
  const spaceBeforeCjk = new RegExp(`\\s+(?=[${cjk}])`, 'g');
  const spaceAfterCjk = new RegExp(`([${cjk}])\\s+`, 'g');

  const lines = raw
    .split(/\r?\n/)
    .map((line) =>
      normalizeDigits(line)
        .replace(spaceBeforeCjk, '')      // CJK文字の直前のスペースを除去
        .replace(spaceAfterCjk, '$1')     // CJK文字の直後のスペースを除去
        .replace(/(\d)\s*[:：]\s*(\d)/g, '$1:$2') // 時刻のコロン周りの空白を除去
        .replace(/(\d)\s+(?=\d)/g, '$1')  // 数字の間のスペースを除去
        .replace(/[ \t　]{2,}/g, ' ')     // 連続スペースを1つにまとめる
        .trim()
    )
    .filter(Boolean);

  return joinWrappedLines(lines).join('\n');
}

async function handleImageSelect(file) {
  try {
    currentImageFile = file;
    const dataUrl = await readFileAsDataURL(file);
    previewImage.src = dataUrl;
    previewImage.style.display = 'block';
    setStatus('画像を読み込みました。OCRを実行してください。');
  } catch (error) {
    setStatus(error.message, true);
  }
}

imageInput.addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (file) {
    await handleImageSelect(file);
  }
});

uploadArea.addEventListener('dragover', (event) => {
  event.preventDefault();
  uploadArea.classList.add('dragover');
});

uploadArea.addEventListener('dragleave', () => {
  uploadArea.classList.remove('dragover');
});

uploadArea.addEventListener('drop', async (event) => {
  event.preventDefault();
  uploadArea.classList.remove('dragover');
  const file = event.dataTransfer?.files?.[0];
  if (file) {
    imageInput.files = event.dataTransfer.files;
    await handleImageSelect(file);
  }
});

uploadArea.addEventListener('click', () => imageInput.click());

ocrButton.addEventListener('click', async () => {
  if (!currentImageFile) {
    setStatus('先に画像を選んでください。', true);
    return;
  }

  try {
    const { text, lines } = await runOCR(currentImageFile);
    const cleanedText = cleanOcrText(text);
    ocrText.value = cleanedText;
    applyHeuristics(cleanedText, lines);
    setStatus('OCR結果を反映しました。必要に応じて内容を修正してください。');
  } catch (error) {
    setStatus(error.message, true);
  }
});

resetButton.addEventListener('click', () => {
  resetForm();
});

copyTextButton.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(ocrText.value);
    setStatus('OCR本文をコピーしました。');
  } catch (error) {
    setStatus('コピーに失敗しました。', true);
  }
});

calendarButton.addEventListener('click', () => {
  const title = titleInput.value.trim();
  const date = dateInput.value;
  const startTime = startTimeInput.value;
  const endTime = endTimeInput.value;
  const location = locationInput.value.trim();
  const details = detailsInput.value.trim();

  if (!title || !date) {
    setStatus('タイトルと日付は必須です。', true);
    return;
  }

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: buildCalendarDates(date, startTime, endTime),
    details,
    location,
  });

  const googleCalendarUrl = `https://calendar.google.com/calendar/render?${params.toString()}`;
  window.open(googleCalendarUrl, '_blank', 'noopener,noreferrer');
  setStatus('Google Calendar の作成画面を開きました。');
});

resetForm();
