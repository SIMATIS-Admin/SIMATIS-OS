import AppKit
import VisioCore

// L'icône de la barre de menus : liste les rendez-vous proches de l'OS, lance et arrête l'enregistrement.
final class BarreDeMenus: NSObject, NSApplicationDelegate, NSMenuDelegate, @unchecked Sendable {
    private let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private let menu = NSMenu()
    private var os: OsClient!
    private var enregistreur: Enregistreur!
    private var proches: [RendezVousProche] = []
    private var enCours: RendezVousProche?
    private var debut: Date?
    private var message: String?
    private var occupe = false
    private var minuteur: Timer?

    func applicationDidFinishLaunching(_ notification: Notification) {
        let defauts = UserDefaults.standard
        let base = URL(string: defauts.string(forKey: "osURL") ?? "http://127.0.0.1:4300")!
        os = OsClient(base: base, instance: defauts.string(forKey: "instance") ?? "simatis")
        enregistreur = Enregistreur(os: os)
        enregistreur.surErreur = { [weak self] texte in
            DispatchQueue.main.async { self?.message = texte; self?.rafraichirTitre() }
        }
        menu.delegate = self
        item.menu = menu
        rafraichirTitre()
        actualiser()
        minuteur = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            self?.rafraichirTitre()
            if let self, Int(Date().timeIntervalSince1970) % 30 == 0 { self.actualiser() }
        }
    }

    private func actualiser() {
        guard enCours == nil else { return }
        Task { @MainActor in
            do {
                let liste = try await self.os.rendezVousProches()
                self.proches = ordonnerPourEnregistrer(liste, maintenant: Date())
                if self.message?.hasPrefix("L'OS") == true { self.message = nil }
            } catch {
                self.message = "L'OS ne répond pas (\(error.localizedDescription))."
            }
        }
    }

    private func rafraichirTitre() {
        let bouton = item.button
        if let debut {
            let s = Int(Date().timeIntervalSince(debut))
            bouton?.image = NSImage(systemSymbolName: "record.circle.fill", accessibilityDescription: "Enregistrement en cours")
            bouton?.contentTintColor = .systemRed
            bouton?.title = String(format: " %02d:%02d", s / 60, s % 60)
        } else {
            bouton?.image = NSImage(systemSymbolName: "waveform", accessibilityDescription: "Visio")
            bouton?.contentTintColor = nil
            bouton?.title = occupe ? " …" : ""
        }
    }

    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()
        if let message { menu.addItem(withTitle: message, action: nil, keyEquivalent: "") ; menu.addItem(.separator()) }
        if let enCours {
            menu.addItem(withTitle: "En cours : \(enCours.titre)", action: nil, keyEquivalent: "")
            let arret = NSMenuItem(title: "Arrêter l'enregistrement", action: #selector(arreter), keyEquivalent: "")
            arret.target = self
            menu.addItem(arret)
        } else if proches.isEmpty {
            menu.addItem(withTitle: "Aucun rendez-vous proche dans l'OS", action: nil, keyEquivalent: "")
        } else {
            menu.addItem(withTitle: "Enregistrer pour le rendez-vous :", action: nil, keyEquivalent: "")
            let heure = DateFormatter()
            heure.dateFormat = "HH:mm"
            for r in proches.prefix(8) {
                let i = NSMenuItem(title: "\(heure.string(from: r.debut))  \(r.titre)", action: #selector(demarrer(_:)), keyEquivalent: "")
                i.target = self
                i.representedObject = r.id
                menu.addItem(i)
            }
        }
        menu.addItem(.separator())
        let quitter = NSMenuItem(title: "Quitter", action: #selector(quitter), keyEquivalent: "q")
        quitter.target = self
        menu.addItem(quitter)
        actualiser()
    }

    @objc private func demarrer(_ sender: NSMenuItem) {
        guard let id = sender.representedObject as? String,
              let rdv = proches.first(where: { $0.id == id }), !occupe else { return }
        occupe = true
        message = nil
        rafraichirTitre()
        Task { @MainActor in
            do {
                try await self.enregistreur.demarrer(rendezVousId: rdv.id)
                self.enCours = rdv
                self.debut = Date()
            } catch {
                self.message = (error as? OsErreur)?.message ?? error.localizedDescription
            }
            self.occupe = false
            self.rafraichirTitre()
        }
    }

    @objc private func arreter() {
        occupe = true
        rafraichirTitre()
        Task { @MainActor in
            await self.enregistreur.arreter()
            self.enCours = nil
            self.debut = nil
            self.occupe = false
            self.rafraichirTitre()
            self.actualiser()
        }
    }

    @objc private func quitter() {
        if enCours == nil {
            NSApplication.shared.terminate(nil)
            return
        }
        Task { @MainActor in
            await self.enregistreur.arreter()
            NSApplication.shared.terminate(nil)
        }
    }
}
