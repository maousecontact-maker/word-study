import AVFoundation
import SwiftUI

/// 영어 단어 발음을 읽어주는 TTS 도우미
final class Speaker {
    static let shared = Speaker()

    // 말하는 도중 해제되지 않도록 강하게 붙잡아 둡니다.
    private let synthesizer = AVSpeechSynthesizer()

    func speak(_ text: String) {
        #if os(iOS) || os(visionOS)
        // 무음 모드에서도 소리가 나도록 재생 카테고리 설정
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
        try? AVAudioSession.sharedInstance().setActive(true)
        #endif

        if synthesizer.isSpeaking {
            synthesizer.stopSpeaking(at: .immediate)
        }
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = AVSpeechSynthesisVoice(language: "en-US")
        utterance.rate = 0.45
        synthesizer.speak(utterance)
    }
}

/// 누르면 단어 발음을 들려주는 스피커 버튼
struct SpeakButton: View {
    let text: String

    var body: some View {
        Button {
            Speaker.shared.speak(text)
        } label: {
            Image(systemName: "speaker.wave.2.fill")
        }
        .buttonStyle(.borderless)
        .accessibilityLabel("발음 듣기")
    }
}
