import AppKit
import SwiftUI
import VisioCore

// Le cœur de l'appli : l'icône de la barre de menus, celle du Dock et la fenêtre. Tout l'état est
// dans `Modele`, partagé avec la fenêtre.
@MainActor
final class BarreDeMenus: NSObject, NSApplicationDelegate, NSMenuDelegate {
    private let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private let menu = NSMenu()
    private let modele = Modele()
    private var fenetre: NSWindow?
    private var minuteur: Timer?

    func applicationDidFinishLaunching(_ notification: Notification) {
        menu.delegate = self
        item.menu = menu
        rafraichirTitre()
        minuteur = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.rafraichirTitre() }
        }
        montrerFenetre()
    }

    // Un clic sur l'icône du Dock rouvre la fenêtre.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        montrerFenetre()
        return false
    }

    // Adresse visio-simatis://enregistrer, depuis le bouton « Enregistrer » de l'OS.
    func application(_ application: NSApplication, open urls: [URL]) {
        montrerFenetre()
        guard urls.contains(where: { $0.host == "enregistrer" }) else { return }
        let rdv = URLComponents(url: urls[0], resolvingAgainstBaseURL: false)?
            .queryItems?.first { $0.name == "rdv" }?.value
        modele.demarrer(rendezVousId: rdv, titre: rdv == nil ? "Enregistrement libre" : "Rendez-vous")
    }

    func applicationDockMenu(_ sender: NSApplication) -> NSMenu? {
        let dock = NSMenu()
        remplir(dock)
        return dock
    }

    private func montrerFenetre() {
        if fenetre == nil {
            let vue = NSHostingView(rootView: VueAppli(modele: modele))
            let f = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 520, height: 680),
                             styleMask: [.titled, .closable, .miniaturizable, .resizable],
                             backing: .buffered, defer: false)
            f.title = "Visio SIMATIS"
            f.contentView = vue
            f.isReleasedWhenClosed = false
            f.center()
            fenetre = f
        }
        NSApp.activate(ignoringOtherApps: true)
        fenetre?.makeKeyAndOrderFront(nil)
    }

    private func rafraichirTitre() {
        let bouton = item.button
        if let debut = modele.debut {
            let s = Int(Date().timeIntervalSince(debut))
            let temps = String(format: "%02d:%02d", s / 60, s % 60)
            bouton?.image = NSImage(systemSymbolName: "record.circle.fill", accessibilityDescription: "Enregistrement en cours")
            bouton?.contentTintColor = .systemRed
            bouton?.title = " " + temps
            // Visible aussi dans le Dock, au cas où l'icône de la barre de menus est cachée par l'encoche.
            NSApp.dockTile.badgeLabel = temps
        } else {
            bouton?.image = NSImage(systemSymbolName: "waveform", accessibilityDescription: "Visio")
            bouton?.contentTintColor = nil
            bouton?.title = modele.occupe ? " Visio …" : " Visio"
            NSApp.dockTile.badgeLabel = nil
        }
    }

    func menuNeedsUpdate(_ menu: NSMenu) {
        remplir(menu)
        Task { await modele.actualiser() }
    }

    private func remplir(_ menu: NSMenu) {
        menu.removeAllItems()
        func ajouter(_ titre: String, _ action: Selector, _ cle: String = "") {
            let i = NSMenuItem(title: titre, action: action, keyEquivalent: cle)
            i.target = self
            menu.addItem(i)
        }
        if let message = modele.message {
            menu.addItem(withTitle: message, action: nil, keyEquivalent: "")
            menu.addItem(.separator())
        }
        if modele.enregistre {
            menu.addItem(withTitle: "En cours : \(modele.enCours ?? "")", action: nil, keyEquivalent: "")
            ajouter("Arrêter l'enregistrement", #selector(arreter))
        } else {
            ajouter("Enregistrer maintenant", #selector(demarrerLibre))
        }
        menu.addItem(.separator())
        ajouter("Ouvrir la fenêtre", #selector(ouvrirFenetre))
        ajouter("Voir les enregistrements dans l'OS", #selector(voirOS))
        ajouter("Quitter", #selector(quitter), "q")
    }

    @objc private func demarrerLibre() { modele.demarrer(rendezVousId: nil, titre: "Enregistrement libre") }
    @objc private func arreter() { modele.arreter() }
    @objc private func ouvrirFenetre() { montrerFenetre() }
    @objc private func voirOS() { NSWorkspace.shared.open(modele.adresseCockpit) }

    @objc private func quitter() {
        guard modele.enregistre else { NSApplication.shared.terminate(nil); return }
        modele.arreter()
        // L'envoi du dernier morceau et la clôture sont lancés : on laisse le temps de les finir.
        DispatchQueue.main.asyncAfter(deadline: .now() + 6) { NSApplication.shared.terminate(nil) }
    }
}
