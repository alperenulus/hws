// Fuzzy matching between OCR text lines and the stored car list.
// Kept format-agnostic on purpose: the user's serial numbers may look like
// "HKJ91", "xxx-111", "228/250", etc. — we normalize and compare distances
// instead of hard-coding one pattern.

function normLoose(s) {
  return (s || '')
    .toUpperCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]/g, '');
}

function normName(s) {
  return (s || '')
    .toUpperCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a, b) {
  const al = a.length, bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;
  let prev = new Array(bl + 1);
  let curr = new Array(bl + 1);
  for (let j = 0; j <= bl; j++) prev[j] = j;
  for (let i = 1; i <= al; i++) {
    curr[0] = i;
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    const tmp = prev; prev = curr; curr = tmp;
  }
  return prev[bl];
}

function similarity(a, b) {
  if (!a.length && !b.length) return 1;
  const dist = levenshtein(a, b);
  return 1 - dist / Math.max(a.length, b.length);
}

// Hot Wheels toy numbers in this collection follow a fixed "LLLDD" shape:
// 3 letters then 2 digits (e.g. "JJK03"). OCR regularly confuses the two
// alphabets at the boundary — 0/O and 1/I/L look alike — so once we know
// which half of a 5-char token is supposed to be letters vs. digits we can
// correct it instead of just guessing from similarity. Returns the
// corrected 5-char code, or null if the token can't be coerced into the
// LLLDD shape at all (so it's probably not a toy number).
function correctCodeToken(token) {
  if (token.length !== 5) return null;
  const letterFix = { 0: 'O', 1: 'I' };
  const digitFix = { O: '0', Q: '0', I: '1', L: '1' };
  let out = '';
  for (let i = 0; i < 5; i++) {
    let c = token[i];
    if (i < 3) {
      if (letterFix[c]) c = letterFix[c];
      if (!/[A-Z]/.test(c)) return null;
    } else {
      if (digitFix[c]) c = digitFix[c];
      if (!/[0-9]/.test(c)) return null;
    }
    out += c;
  }
  return out;
}

// Slides a 5-char window over every run of letters/digits in the OCR text
// (ignoring spaces/dashes OCR might insert inside a code) and keeps
// whichever windows are valid LLLDD codes once corrected.
function extractCodeCandidates(text) {
  const cleaned = normLoose(text);
  const candidates = new Set();
  for (let i = 0; i + 5 <= cleaned.length; i++) {
    const corrected = correctCodeToken(cleaned.slice(i, i + 5));
    if (corrected) candidates.add(corrected);
  }
  return candidates;
}

// ocrLines: array of raw text lines/blocks from OCR.
// cars: array of { id, name, number, status }.
// Returns candidates sorted by score desc: [{ car, score }]
function findMatches(ocrLines, cars, { limit = 5, minScore = 0.4 } = {}) {
  const variants = [];
  for (const line of ocrLines) {
    const raw = (line || '').trim();
    if (!raw) continue;
    variants.push({ loose: normLoose(raw), name: normName(raw) });
    // Also split into words — card names are sometimes surrounded by other
    // printed text on the same OCR line.
    for (const word of raw.split(/\s+/)) {
      if (word.length >= 3) variants.push({ loose: normLoose(word), name: '' });
    }
  }
  const codeCandidates = extractCodeCandidates(ocrLines.join(' '));

  const results = [];
  for (const car of cars) {
    const carNumLoose = normLoose(car.number);
    const carNameNorm = normName(car.name);
    const carCode = carNumLoose.length === 5 ? correctCodeToken(carNumLoose) : null;
    let best = 0;

    // Exact LLLDD code match (after 0/O/1/I correction) beats everything —
    // it's what disambiguates two codes that only differ in their digits,
    // e.g. JJK03 vs JJK14, once the OCR actually read both digits.
    if (carCode && codeCandidates.has(carCode)) best = 1;

    for (const v of variants) {
      if (carNumLoose && carNumLoose.length >= 3 && v.loose) {
        if (v.loose === carNumLoose) {
          best = Math.max(best, 1);
        } else if (
          (v.loose.includes(carNumLoose) || carNumLoose.includes(v.loose)) &&
          Math.min(v.loose.length, carNumLoose.length) / Math.max(v.loose.length, carNumLoose.length) >= 0.7
        ) {
          // Require most of the number to be present — a bare "JJK" shouldn't
          // be treated as a confident hit against "JJK03" AND "JJK14" alike.
          best = Math.max(best, 0.85);
        } else {
          best = Math.max(best, similarity(v.loose, carNumLoose) * 0.8);
        }
      }
      if (carNameNorm && v.name) {
        if (v.name === carNameNorm) {
          best = Math.max(best, 1);
        } else if (
          (v.name.includes(carNameNorm) || carNameNorm.includes(v.name)) &&
          Math.min(v.name.length, carNameNorm.length) / Math.max(v.name.length, carNameNorm.length) >= 0.7
        ) {
          // Same guard as the number check above: a short fragment like "JJK"
          // shouldn't count as a confident hit against a longer, unrelated name.
          best = Math.max(best, 0.88);
        } else {
          best = Math.max(best, similarity(v.name, carNameNorm) * 0.82);
        }
      }
    }

    if (best >= minScore) results.push({ car, score: best });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}
