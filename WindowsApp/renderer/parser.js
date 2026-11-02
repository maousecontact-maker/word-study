'use strict';

const HANGUL = /[가-힣ㄱ-ㆎ]/;
const hasHangul = (text) => HANGUL.test(text);

/**
 * 붙여넣은 텍스트를 단어 목록으로 변환합니다.
 *
 * 지원하는 형식:
 * - 마크다운 표: `| hello | 안녕하세요 | everyone | 여러분 |` (한 줄에 여러 쌍 가능)
 * - 엑셀/구글 시트/퀴즐렛 복사: 탭으로 구분된 칸
 * - 한 줄에 한 쌍: `apple - 사과`, `apple: 사과`, `apple = 사과`, `apple, 사과`, `apple 사과`
 */
const WordParser = (() => {
  const headerWords = new Set([
    '영어', '뜻', '단어', '의미', '한글', '한국어', '영단어',
    'english', 'meaning', 'word', 'term', 'definition', 'korean',
  ]);

  function parse(text) {
    const result = [];
    const seen = new Set();

    for (const rawLine of text.split(/\r\n|\r|\n/)) {
      const line = rawLine.trim();
      if (!line) continue;

      const cells = splitCells(line).map(clean);
      if (!cells.length || isSeparatorRow(cells) || isHeaderRow(cells)) continue;

      // 칸을 두 개씩 묶어 (영어, 뜻) 쌍으로 만듭니다.
      for (let i = 0; i + 1 < cells.length; i += 2) {
        const word = makeWord(cells[i], cells[i + 1]);
        if (!word) continue;
        const key = `${word.term}\u0000${word.meaning}`;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(word);
      }
    }
    return result;
  }

  function splitCells(line) {
    if (line.includes('|')) {
      const cells = line.split('|');
      // "| a | b |" 처럼 양 끝에 있는 파이프가 만드는 빈 칸 제거
      if (line.startsWith('|')) cells.shift();
      if (line.endsWith('|') && cells.length) cells.pop();
      return cells;
    }
    if (line.includes('\t')) {
      return line.split('\t');
    }
    // 한 줄에 한 쌍인 형식: 첫 번째 구분자에서만 나눠서 뜻 안의 쉼표 등은 유지
    for (const separator of [' - ', ' – ', ' — ', ':', '=', ',']) {
      const at = line.indexOf(separator);
      if (at >= 0) return [line.slice(0, at), line.slice(at + separator.length)];
    }
    // "apple 사과"처럼 구분자 없이 한글이 시작되는 지점에서 나누기
    const hangulAt = line.search(HANGUL);
    if (hangulAt > 0) return [line.slice(0, hangulAt), line.slice(hangulAt)];
    return [];
  }

  /** 마크다운 서식(**굵게**, `코드` 등)과 공백 제거 */
  function clean(cell) {
    return cell.replaceAll('**', '').replaceAll('__', '').replaceAll('`', '').trim();
  }

  /** `|---|---|` 같은 표 구분선인지 */
  function isSeparatorRow(cells) {
    return cells.some((c) => c.includes('-')) && cells.every((c) => [...c].every((ch) => '-: '.includes(ch)));
  }

  /** `| 영어 | 뜻 |` 같은 제목 줄인지 */
  function isHeaderRow(cells) {
    const nonEmpty = cells.filter((c) => c);
    return nonEmpty.length > 0 && nonEmpty.every((c) => headerWords.has(c.toLowerCase()));
  }

  function makeWord(first, second) {
    if (!first || !second) return null;
    // "사과 | apple"처럼 순서가 반대면 자동으로 바꿔줍니다.
    if (hasHangul(first) && !hasHangul(second)) return { term: second, meaning: first };
    return { term: first, meaning: second };
  }

  return { parse };
})();

/**
 * 타이핑한 뜻이 정답인지 너그럽게 비교합니다.
 * - 뜻이 "여러분, 모든 사람"처럼 여러 개면 그중 하나만 맞혀도 정답
 * - 띄어쓰기, `~`, 문장부호는 무시 ("~할 수 있다" ↔ "할수있다")
 * - 괄호 안 내용은 있어도 없어도 정답 ("(음식을) 먹다" ↔ "먹다")
 */
const AnswerChecker = (() => {
  const normalize = (text) => text.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
  const removingParentheses = (text) => text.replace(/\([^)]*\)/g, '');

  function isCorrect(answer, meaning) {
    const typed = normalize(answer);
    if (!typed) return false;

    const candidates = [meaning, ...meaning.split(/[,/;·]/)];
    const accepted = candidates.flatMap((c) => [normalize(c), normalize(removingParentheses(c))]);
    return accepted.some((a) => a && a === typed);
  }

  return { isCorrect };
})();
