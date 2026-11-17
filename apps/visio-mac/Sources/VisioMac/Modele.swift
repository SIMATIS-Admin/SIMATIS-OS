import AppKit
import Foundation
import VisioCore

// L'état partagé par la barre de menus et la fenêtre : un seul enregistrement à la fois, la liste
// des enregistrements de l'OS et les rendez-vous proches.
@MainActor
final class Modele: ObservableObject {
    @Published var proches: [RendezVousProche] = []
    @Published var enregistrements: [EnregistrementResume] = []
    @Published var details: [String: DetailSession] = [:]
    @Published var enCours: String?
    @Published var debut: Date?
    @Published var message: String?
    @Published var occupe = false

    let os: OsClient
    private let enregistreur: Enregistreur
    private var minuteur: Timer?

    init() {
        let defauts = UserDefaults.standard
        let base = URL(string: defauts.string(forKey: "osURL") ?? "http://127.0.0.1:4300")!
        os = OsClient(base: base, instance: defauts.string(forKey: "instance") ?? "simatis")
        enregistreur = Enregistreur(os: os)
        enregistreur.surErreur = { [weak self] texte in
            DispatchQueue.main.async { self?.message = texte }
        }
        minuteur = Timer.scheduledTimer(withTimeInterval: 10, repeats: true) { [weak self] _ in
            Task { @MainActor in await self?.actualiser() }
        }
        Task { await actualiser() }
    }

    var enregistre: Bool { enCours != nil }
    var adresseCockpit: URL { os.adresseCockpit }

    func actualiser() async {
        do {
            proches = ordonnerPourEnregistrer(try await os.rendezVousProches(), maintenant: Date())
            enregistrements = try await os.enregistrements()
            if message?.hasPrefix("L'OS") == true { message = nil }
        } catch {
            message = "L'OS ne répond pas (\(error.localizedDescription))."
        }
    }

    // `rendezVousId` nil : enregistrement libre, l'OS crée le rendez-vous.
    func demarrer(rendezVousId: String?, titre: String) {
        guard !occupe, !enregistre else { return }
        occupe = true
        message = nil
        Task {
            do {
                try await enregistreur.demarrer(rendezVousId: rendezVousId)
                enCours = titre
                debut = Date()
            } catch {
                message = (error as? OsErreur)?.message ?? error.localizedDescription
            }
            occupe = false
            await actualiser()
        }
    }

    func arreter() {
        guard enregistre, !occupe else { return }
        occupe = true
        Task {
            await enregistreur.arreter()
            enCours = nil
            debut = nil
            occupe = false
            await actualiser()
        }
    }

    func chargerDetail(_ id: String) {
        Task {
            if let d = try? await os.detail(sessionId: id) { details[id] = d }
        }
    }

    func supprimer(_ e: EnregistrementResume) {
        Task {
            do {
                try await os.supprimer(sessionId: e.id)
                details[e.id] = nil
                await actualiser()
            } catch {
                message = (error as? OsErreur)?.message ?? error.localizedDescription
            }
        }
    }
}
