import AVFoundation
import Foundation
import Speech
import VisioCore

// Écoute le micro pendant l'enregistrement et reconnaît la phrase « arrête l'enregistrement »,
// sur le Mac (reconnaissance vocale du système, sans envoi sur Internet quand le français est
// installé en local). La reconnaissance se renouvelle toutes les 50 s : sa durée est limitée.
final class ArretVocal: @unchecked Sendable {
    var surCommande: (@Sendable () -> Void)?
    private let reco = SFSpeechRecognizer(locale: Locale(identifier: "fr-FR"))
    private let file = DispatchQueue(label: "os.simatis.visio.voix")
    private var requete: SFSpeechAudioBufferRecognitionRequest?
    private var tache: SFSpeechRecognitionTask?
    private var renouvellement: DispatchSourceTimer?
    private var actif = false

    func demarrer() {
        SFSpeechRecognizer.requestAuthorization { [weak self] statut in
            guard statut == .authorized, let self else { return }
            self.file.async {
                self.actif = true
                self.lancer()
                let t = DispatchSource.makeTimerSource(queue: self.file)
                t.schedule(deadline: .now() + 50, repeating: 50)
                t.setEventHandler { [weak self] in self?.lancer() }
                t.resume()
                self.renouvellement = t
            }
        }
    }

    func arreter() {
        file.async {
            self.actif = false
            self.renouvellement?.cancel()
            self.renouvellement = nil
            self.liberer()
        }
    }

    func alimenter(_ tampon: AVAudioPCMBuffer) {
        file.async { self.requete?.append(tampon) }
    }

    private func liberer() {
        requete?.endAudio()
        tache?.cancel()
        requete = nil
        tache = nil
    }

    private func lancer() {
        guard actif, let reco, reco.isAvailable else { return }
        liberer()
        let r = SFSpeechAudioBufferRecognitionRequest()
        r.shouldReportPartialResults = true
        if reco.supportsOnDeviceRecognition { r.requiresOnDeviceRecognition = true }
        requete = r
        tache = reco.recognitionTask(with: r) { [weak self] resultat, erreur in
            guard let self else { return }
            if let texte = resultat?.bestTranscription.formattedString, contientCommandeArret(texte) {
                self.file.async {
                    guard self.actif else { return }
                    self.actif = false
                    self.liberer()
                    self.surCommande?()
                }
            } else if erreur != nil {
                // La reconnaissance s'est arrêtée (silence, limite) : on la relance sans bruit.
                self.file.asyncAfter(deadline: .now() + 1) { self.lancer() }
            }
        }
    }
}
