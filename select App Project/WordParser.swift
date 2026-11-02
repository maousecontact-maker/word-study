import Foundation

struct ParsedWord: Hashable {
    let term: String
    let meaning: String
}

/// 붙여넣은 텍스트를 단어 목록으로 변환합니다.
///
/// 지원하는 형식:
/// - 마크다운 표: `| hello | 안녕하세요 | everyone | 여러분 |` (한 줄에 여러 쌍 가능)
/// - 엑셀/구글 시트/퀴즐렛 복사: 탭으로 구분된 칸
/// - 한 줄에 한 쌍: `apple - 사과`, `apple: 사과`, `apple = 사과`, `apple, 사과`, `apple 사과`
enum WordParser {
    private static let headerWords: Set<String> = [
        "영어", "뜻", "단어", "의미", "한글", "한국어", "영단어",
        "english", "meaning", "word", "term", "definition", "korean"
    ]

    static func parse(_ text: String) -> [ParsedWord] {
        var result: [ParsedWord] = []
        var seen = Set<ParsedWord>()

        for rawLine in text.components(separatedBy: .newlines) {
            let line = rawLine.trimmingCharacters(in: .whitespaces)
            guard !line.isEmpty else { continue }

            let cells = splitCells(line).map(clean)
            guard !cells.isEmpty, !isSeparatorRow(cells), !isHeaderRow(cells) else { continue }

            // 칸을 두 개씩 묶어 (영어, 뜻) 쌍으로 만듭니다.
            var index = 0
            while index + 1 < cells.count {
                if let word = makeWord(cells[index], cells[index + 1]), seen.insert(word).inserted {
                    result.append(word)
                }
                index += 2
            }
        }
        return result
    }

    // MARK: - Helpers

    private static func splitCells(_ line: String) -> [String] {
        if line.contains("|") {
            var cells = line.components(separatedBy: "|")
            // "| a | b |" 처럼 양 끝에 있는 파이프가 만드는 빈 칸 제거
            if line.hasPrefix("|") { cells.removeFirst() }
            if line.hasSuffix("|"), !cells.isEmpty { cells.removeLast() }
            return cells
        }
        if line.contains("\t") {
            return line.components(separatedBy: "\t")
        }
        // 한 줄에 한 쌍인 형식: 첫 번째 구분자에서만 나눠서 뜻 안의 쉼표 등은 유지
        for separator in [" - ", " – ", " — ", ":", "=", ","] {
            if let range = line.range(of: separator) {
                return [String(line[..<range.lowerBound]), String(line[range.upperBound...])]
            }
        }
        // "apple 사과"처럼 구분자 없이 한글이 시작되는 지점에서 나누기
        if let hangulIndex = line.firstIndex(where: \.isHangul), hangulIndex != line.startIndex {
            return [String(line[..<hangulIndex]), String(line[hangulIndex...])]
        }
        return []
    }

    /// 마크다운 서식(**굵게**, `코드` 등)과 공백 제거
    private static func clean(_ cell: String) -> String {
        cell.replacingOccurrences(of: "**", with: "")
            .replacingOccurrences(of: "__", with: "")
            .replacingOccurrences(of: "`", with: "")
            .trimmingCharacters(in: .whitespaces)
    }

    /// `|---|---|` 같은 표 구분선인지
    private static func isSeparatorRow(_ cells: [String]) -> Bool {
        cells.contains { $0.contains("-") }
            && cells.allSatisfy { $0.allSatisfy { "-: ".contains($0) } }
    }

    /// `| 영어 | 뜻 |` 같은 제목 줄인지
    private static func isHeaderRow(_ cells: [String]) -> Bool {
        let nonEmpty = cells.filter { !$0.isEmpty }
        return !nonEmpty.isEmpty && nonEmpty.allSatisfy { headerWords.contains($0.lowercased()) }
    }

    private static func makeWord(_ first: String, _ second: String) -> ParsedWord? {
        guard !first.isEmpty, !second.isEmpty else { return nil }
        // "사과 | apple"처럼 순서가 반대면 자동으로 바꿔줍니다.
        if first.contains(where: \.isHangul), !second.contains(where: \.isHangul) {
            return ParsedWord(term: second, meaning: first)
        }
        return ParsedWord(term: first, meaning: second)
    }
}

private extension Character {
    var isHangul: Bool {
        unicodeScalars.contains { (0xAC00...0xD7A3).contains($0.value) || (0x3131...0x318E).contains($0.value) }
    }
}
