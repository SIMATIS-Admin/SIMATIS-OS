import AVFoundation
import Testing
@testable import VisioCore

@Suite struct EcritureAACTests {
    // Le micro arrive en 16 kHz mono, le son du système en 48 kHz stéréo : les deux doivent s'écrire.
    @Test(arguments: [(16_000.0, 1), (48_000.0, 2), (44_100.0, 1)])
    func ecritUnMorceauAAC(cadence: Double, canaux: Int) throws {
        let format = try #require(AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: cadence,
                                                channels: AVAudioChannelCount(canaux), interleaved: false))
        let images = AVAudioFrameCount(cadence)
        let tampon = try #require(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: images))
        tampon.frameLength = images
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("test-\(UUID().uuidString).m4a")
        defer { try? FileManager.default.removeItem(at: url) }
        var fichier: AVAudioFile? = try ouvrirFichierAAC(url: url, format: format)
        try fichier?.write(from: tampon)
        fichier = nil
        let taille = (try FileManager.default.attributesOfItem(atPath: url.path)[.size] as? Int) ?? 0
        #expect(taille > 500)
    }
}
