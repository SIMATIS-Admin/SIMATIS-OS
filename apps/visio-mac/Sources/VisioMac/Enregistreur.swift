import AVFoundation
import CoreMedia
import Foundation
import ScreenCaptureKit
import VisioCore

// Capte le micro et le son du Mac (tout ce qui sort des haut-parleurs, quelle que soit
// l'application) avec ScreenCaptureKit, les écrit en fichiers autonomes de 30 s par piste, et les
// confie à l'expéditeur. L'image de l'écran n'est jamais lue ni gardée.
final class Enregistreur: NSObject, SCStreamOutput, SCStreamDelegate, @unchecked Sendable {
    private let os: OsClient
    private let file = DispatchQueue(label: "os.simatis.visio.audio")
    private var flux: SCStream?
    private var sessionId: String?
    private var plan = PlanMorceaux(dureeMs: 30_000)
    private var fichiers: [Piste: FichierMorceau] = [:]
    private var minuteur: DispatchSourceTimer?
    private var expediteur: ExpediteurOrdonne?
    private let dossier = FileManager.default.temporaryDirectory.appendingPathComponent("visio-mac", isDirectory: true)
    var surErreur: (@Sendable (String) -> Void)?
    // Les buffers du micro, pour l'arrêt à la voix.
    var surMicro: (@Sendable (AVAudioPCMBuffer) -> Void)?

    init(os: OsClient) {
        self.os = os
    }

    // Un fichier AAC en cours d'écriture pour une piste.
    private final class FichierMorceau {
        let url: URL
        var fichier: AVAudioFile?
        var ecrit = false
        init(url: URL) { self.url = url }
    }

    func demarrer(rendezVousId: String?) async throws {
        try FileManager.default.createDirectory(at: dossier, withIntermediateDirectories: true)
        guard await AVCaptureDevice.requestAccess(for: .audio) else {
            throw OsErreur(statut: 0, message: "Accès au micro refusé (Réglages Système > Confidentialité).")
        }
        let contenu: SCShareableContent
        do {
            contenu = try await SCShareableContent.current
        } catch {
            throw OsErreur(statut: 0, message: "Autorisation « Enregistrement de l'écran et du son du système » refusée ou périmée : quittez l'appli, relancez-la (voir docs/EXPLOITATION.md si le problème persiste).")
        }
        guard let ecran = contenu.displays.first else {
            throw OsErreur(statut: 0, message: "Aucun écran trouvé pour capter le son.")
        }
        let id = try await os.ouvrirSession(rendezVousId: rendezVousId)
        sessionId = id
        plan = PlanMorceaux(dureeMs: 30_000)
        fichiers = [:]
        let erreur = surErreur
        expediteur = ExpediteurOrdonne(
            pause: { try? await Task.sleep(nanoseconds: 2_000_000_000) },
            surErreur: { erreur?("Un morceau n'a pas pu être envoyé : \($0.localizedDescription)") })

        let config = SCStreamConfiguration()
        config.capturesAudio = true
        config.excludesCurrentProcessAudio = true
        config.captureMicrophone = true
        config.sampleRate = 48_000
        config.channelCount = 2
        // L'image est exigée par ScreenCaptureKit mais jetée : on la réduit au minimum.
        config.width = 2
        config.height = 2
        config.minimumFrameInterval = CMTime(value: 1, timescale: 1)
        let filtre = SCContentFilter(display: ecran, excludingWindows: [])
        let s = SCStream(filter: filtre, configuration: config, delegate: self)
        try s.addStreamOutput(self, type: .audio, sampleHandlerQueue: file)
        try s.addStreamOutput(self, type: .microphone, sampleHandlerQueue: file)
        try s.addStreamOutput(self, type: .screen, sampleHandlerQueue: file)
        try await s.startCapture()
        flux = s

        let t = DispatchSource.makeTimerSource(queue: file)
        t.schedule(deadline: .now() + 30, repeating: 30)
        t.setEventHandler { [weak self] in self?.faireTourner() }
        t.resume()
        minuteur = t
    }

    func arreter() async {
        minuteur?.cancel()
        minuteur = nil
        try? await flux?.stopCapture()
        flux = nil
        // Le dernier morceau est coupé sur la file audio, après les derniers buffers reçus.
        await withCheckedContinuation { (suite: CheckedContinuation<Void, Never>) in
            file.async {
                self.faireTourner()
                suite.resume()
            }
        }
        await expediteur?.attendreFin()
        if let id = sessionId {
            do { try await os.clore(sessionId: id) } catch {
                surErreur?("La session n'a pas pu être close : \(error.localizedDescription)")
            }
        }
        sessionId = nil
        expediteur = nil
    }

    // Ferme les fichiers en cours et les envoie ; de nouveaux s'ouvrent au prochain son reçu.
    private func faireTourner() {
        guard let id = sessionId, let exp = expediteur else { return }
        for (piste, morceau) in fichiers {
            morceau.fichier = nil
            fichiers[piste] = nil
            guard morceau.ecrit else {
                try? FileManager.default.removeItem(at: morceau.url)
                continue
            }
            let rang = plan.prochainRang(piste)
            let debutMs = plan.debutMs(rang: rang)
            let os = self.os
            let url = morceau.url
            Task {
                await exp.envoyer {
                    let audio = try Data(contentsOf: url)
                    try await os.envoyerMorceau(sessionId: id, piste: piste, rang: rang, debutMs: debutMs,
                                                mime: "audio/mp4", audio: audio)
                    try? FileManager.default.removeItem(at: url)
                }
            }
        }
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer tampon: CMSampleBuffer, of type: SCStreamOutputType) {
        let piste: Piste
        switch type {
        case .audio: piste = .autres
        case .microphone: piste = .moi
        default: return
        }
        guard tampon.isValid, let pcm = Self.versPCM(tampon) else { return }
        if piste == .moi { surMicro?(pcm) }
        let morceau: FichierMorceau
        if let existant = fichiers[piste] {
            morceau = existant
        } else {
            morceau = FichierMorceau(url: dossier.appendingPathComponent("\(UUID().uuidString)-\(piste.rawValue).m4a"))
            fichiers[piste] = morceau
        }
        do {
            if morceau.fichier == nil {
                morceau.fichier = try ouvrirFichierAAC(url: morceau.url, format: pcm.format)
            }
            try morceau.fichier?.write(from: pcm)
            morceau.ecrit = true
        } catch {
            surErreur?("Écriture du son impossible : \(error.localizedDescription)")
        }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        surErreur?("La capture s'est arrêtée : \(error.localizedDescription)")
    }

    private static func versPCM(_ tampon: CMSampleBuffer) -> AVAudioPCMBuffer? {
        guard let description = tampon.formatDescription else { return nil }
        let format = AVAudioFormat(cmAudioFormatDescription: description)
        let images = AVAudioFrameCount(CMSampleBufferGetNumSamples(tampon))
        guard images > 0, let pcm = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: images) else { return nil }
        pcm.frameLength = images
        let code = CMSampleBufferCopyPCMDataIntoAudioBufferList(
            tampon, at: 0, frameCount: Int32(images), into: pcm.mutableAudioBufferList)
        return code == noErr ? pcm : nil
    }
}
