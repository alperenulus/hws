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

  const results = [];
  for (const car of cars) {
    const carNumLoose = normLoose(car.number);
    const carNameNorm = normName(car.name);
    let best = 0;

    for (const v of variants) {
      if (carNumLoose && carNumLoose.length >= 3 && v.loose) {
        if (v.loose === carNumLoose) best = Math.max(best, 1);
        else if (v.loose.length >= 3 && (v.loose.includes(carNumLoose) || carNumLoose.includes(v.loose))) {
          best = Math.max(best, 0.9);
        } else {
          best = Math.max(best, similarity(v.loose, carNumLoose) * 0.85);
        }
      }
      if (carNameNorm && v.name) {
        if (v.name === carNameNorm) best = Math.max(best, 1);
        else if (v.name.includes(carNameNorm) || carNameNorm.includes(v.name)) {
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
