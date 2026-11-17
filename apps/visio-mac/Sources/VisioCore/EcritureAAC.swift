import AVFoundation

// Ouvre un fichier AAC (.m4a) pour y écrire des buffers du format donné (micro, son du système).
public func ouvrirFichierAAC(url: URL, format: AVAudioFormat) throws -> AVAudioFile {
    try AVAudioFile(
        forWriting: url,
        settings: [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: format.sampleRate,
            AVNumberOfChannelsKey: format.channelCount,
            // Pas de débit imposé : 64 kbit/s est refusé par l'encodeur pour la voix du micro (16 kHz mono).
            AVEncoderAudioQualityKey: AVAudioQuality.medium.rawValue,
        ],
        commonFormat: format.commonFormat,
        interleaved: format.isInterleaved)
}
