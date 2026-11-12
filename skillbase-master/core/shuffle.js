// core/shuffle.js — детерминированное перемешивание для попыток.
// Порядок вопросов и вариантов зависит только от seed (id попытки), поэтому
// после перезагрузки страницы ученик видит тот же порядок. Ответы по-прежнему
// хранятся по исходным индексам, так что проверка и просмотр не меняются.

function hashSeed(seed) {
  let h = 1779033703 ^ String(seed).length;
  for (let i = 0; i < String(seed).length; i++) {
    h = Math.imul(h ^ String(seed).charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

function mulberry32(a) {
  return function next() {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Перестановка 0..count-1, одна и та же для одного seed.
export function seededOrder(count, seed) {
  const order = Array.from({ length: Math.max(0, count) }, (_, i) => i);
  const random = mulberry32(hashSeed(seed));
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

export function identityOrder(count) {
  return Array.from({ length: Math.max(0, count) }, (_, i) => i);
}

// Порядок вопросов и вариантов для попытки. Короткие ответы не перемешиваются.
export function buildAttemptOrder(questions, settings, seed, enabled = true) {
  const list = Array.isArray(questions) ? questions : [];
  const shuffleQ = enabled && settings?.shuffleQuestions === true;
  const shuffleO = enabled && settings?.shuffleOptions === true;
  return {
    questions: shuffleQ ? seededOrder(list.length, `${seed}:q`) : identityOrder(list.length),
    options: list.map((question, index) => {
      const count = Array.isArray(question?.options) ? question.options.length : 0;
      return shuffleO && question?.type !== "short"
        ? seededOrder(count, `${seed}:o:${index}`)
        : identityOrder(count);
    })
  };
}
