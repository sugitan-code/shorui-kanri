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

function inferTitle(text) {
  const lines = text.split(/\n|\r/).map((line) => line.trim()).filter(Boolean);
  const priorityPatterns = [
    /イベント|会議|説明会|講演|面談|打ち合わせ|予約|試験|発表|セミナー|受付|訪問|出張|研修/
  ];

  for (const line of lines) {
    if (priorityPatterns.some((pattern) => pattern.test(line))) {
      return line;
    }
  }

  return lines[0] || 'イベント';
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

function applyHeuristics(text) {
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

  const inferredTitle = inferTitle(text);
  titleInput.value = inferredTitle;

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

async function runOCR(imageFile) {
  if (!imageFile) {
    throw new Error('画像が選択されていません。');
  }

  setStatus('OCRを実行しています...');
  const { data } = await Tesseract.recognize(imageFile, 'jpn+eng', {
    logger: (m) => {
      if (m.status === 'recognizing text') {
        setStatus(`OCR進行中: ${Math.round(m.progress * 100)}%`);
      }
    },
  });

  return data.text;
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
    const text = await runOCR(currentImageFile);
    const cleanedText = text.replace(/\s+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    ocrText.value = cleanedText;
    applyHeuristics(cleanedText);
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
