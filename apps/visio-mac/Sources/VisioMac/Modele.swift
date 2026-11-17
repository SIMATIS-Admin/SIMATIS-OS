import AppKit
import Foundation
import UserNotifications
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
    private let voix = ArretVocal()
    private var detecteur = Detecteur()
    private var minuteur: Timer?
    private var surveillance: Timer?

    init() {
        let defauts = UserDefaults.standard
        let base = URL(string: defauts.string(forKey: "osURL") ?? "http://127.0.0.1:4300")!
        os = OsClient(base: base, instance: defauts.string(forKey: "instance") ?? "simatis")
        enregistreur = Enregistreur(os: os)
        enregistreur.surErreur = { [weak self] texte in
            DispatchQueue.main.async { self?.message = texte }
        }
        enregistreur.surMicro = { [weak self] tampon in self?.voix.alimenter(tampon) }
        voix.surCommande = { [weak self] in
            Task { @MainActor in
                guard let self, self.enregistre else { return }
                self.arreter()
                self.notifier("Enregistrement arrêté", "Commande vocale reconnue.")
            }
        }
        // Détection de réunion : toutes les 2 s, qui utilise le micro ?
        surveillance = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.surveiller() }
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
                voix.demarrer()
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
            voix.arreter()
            await enregistreur.arreter()
            enCours = nil
            debut = nil
            occupe = false
            await actualiser()
        }
    }

    private func surveiller() {
        let apps = appsDeReunion(applisUtilisantLeMicro())
        switch detecteur.echantillon(apps: apps, enregistre: enregistre, maintenant: Date()) {
        case .proposer:
            notifier("Réunion détectée", "Voulez-vous l'enregistrer ?", proposition: true)
        case .arreter:
            arreter()
            notifier("Enregistrement arrêté", "La réunion est terminée.")
        case nil:
            break
        }
    }

    // Le rendez-vous de l'agenda qui a lieu maintenant, sinon un enregistrement libre.
    func demarrerPourLaReunionEnCours() {
        let maintenant = Date()
        let rdv = proches.first { $0.debut <= maintenant && maintenant <= $0.fin }
        demarrer(rendezVousId: rdv?.id, titre: rdv?.titre ?? "Enregistrement libre")
    }

    func notifier(_ titre: String, _ texte: String, proposition: Bool = false) {
        let contenu = UNMutableNotificationContent()
        contenu.title = titre
        contenu.body = texte
        contenu.sound = .default
        if proposition { contenu.categoryIdentifier = "REUNION" }
        UNUserNotificationCenter.current().add(
            UNNotificationRequest(identifier: UUID().uuidString, content: contenu, trigger: nil))
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
