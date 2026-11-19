import AppKit
import SwiftUI
import VisioCore

private let marine = Color(red: 0.06, green: 0.16, blue: 0.32)
private let rouge = Color(red: 0.89, green: 0.16, blue: 0.20)

// La fenêtre de l'appli : le bouton d'enregistrement, les enregistrements et leur texte.
@MainActor
final class EtatVue: ObservableObject {
    @Published var rendezVousChoisi = ""
    @Published var ouverts: Set<String> = []
    @Published var aSupprimer: EnregistrementResume?
}

struct VueAppli: View {
    @ObservedObject var modele: Modele
    // Objet observable plutôt que @State : la chaîne d'outils sans Xcode n'a pas le plugin de macro.
    @StateObject private var etat = EtatVue()

    var body: some View {
        VStack(spacing: 0) {
            entete
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if let m = modele.message {
                        Text(m).font(.callout).foregroundStyle(rouge)
                            .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                            .background(rouge.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
                    }
                    enregistrer
                    liste
                }
                .padding(20)
            }
        }
        .frame(minWidth: 460, minHeight: 560)
        .confirmationDialog(
            "Supprimer « \(etat.aSupprimer?.titre ?? "") » ?",
            isPresented: Binding(get: { etat.aSupprimer != nil }, set: { if !$0 { etat.aSupprimer = nil } }),
            titleVisibility: .visible
        ) {
            Button("Supprimer", role: .destructive) {
                if let e = etat.aSupprimer { modele.supprimer(e) }
                etat.aSupprimer = nil
            }
            Button("Annuler", role: .cancel) { etat.aSupprimer = nil }
        } message: {
            Text("Son texte et son résumé seront perdus.")
        }
    }

    private var entete: some View {
        HStack(spacing: 12) {
            if let chemin = Bundle.main.path(forResource: "simatis-mark", ofType: "png"),
               let image = NSImage(contentsOfFile: chemin) {
                Image(nsImage: image).resizable().scaledToFit().frame(height: 34)
            }
            VStack(alignment: .leading, spacing: 0) {
                Text("Visio SIMATIS").font(.headline).foregroundStyle(.white)
                Text("Enregistrer et transcrire une visio").font(.caption).foregroundStyle(.white.opacity(0.7))
            }
            Spacer()
            Button("Ouvrir l'OS") { NSWorkspace.shared.open(modele.adresseCockpit) }
                .buttonStyle(.bordered).tint(.white)
        }
        .padding(.horizontal, 20).padding(.vertical, 14)
        .background(marine)
    }

    private var enregistrer: some View {
        VStack(alignment: .leading, spacing: 10) {
            if modele.enregistre, let debut = modele.debut {
                TimelineView(.periodic(from: .now, by: 1)) { ctx in
                    let s = Int(ctx.date.timeIntervalSince(debut))
                    HStack {
                        Circle().fill(rouge).frame(width: 12, height: 12)
                        Text("Enregistrement en cours · " + String(format: "%02d:%02d", s / 60, s % 60))
                            .font(.title3.bold())
                        Spacer()
                    }
                }
                Button { modele.arreter() } label: {
                    Label("Arrêter l'enregistrement", systemImage: "stop.fill").frame(maxWidth: .infinity)
                }
                .controlSize(.large).buttonStyle(.borderedProminent).tint(marine).disabled(modele.occupe)
            } else {
                Picker("Pour le rendez-vous", selection: $etat.rendezVousChoisi) {
                    Text("Enregistrement libre").tag("")
                    ForEach(modele.proches.prefix(8), id: \.id) { r in
                        Text("\(heure(r.debut))  \(r.titre)").tag(r.id)
                    }
                }
                Button {
                    let rdv = modele.proches.first { $0.id == etat.rendezVousChoisi }
                    modele.demarrer(rendezVousId: rdv?.id, titre: rdv?.titre ?? "Enregistrement libre")
                } label: {
                    Label("Enregistrer", systemImage: "record.circle").frame(maxWidth: .infinity)
                }
                .controlSize(.large).buttonStyle(.borderedProminent).tint(rouge).disabled(modele.occupe)
            }
        }
        .padding(16)
        .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 12))
    }

    private var liste: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Enregistrements").font(.headline)
            if modele.enregistrements.isEmpty {
                Text("Aucun enregistrement pour l'instant.").foregroundStyle(.secondary)
            }
            ForEach(modele.enregistrements) { e in
                VStack(alignment: .leading, spacing: 6) {
                    HStack(alignment: .top) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(e.titre).font(.subheadline.bold())
                            Text("\(jour(e.debutAt)) · \(e.etat)").font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Button(etat.ouverts.contains(e.id) ? "Masquer" : "Voir") { basculer(e) }
                        Button("Supprimer", role: .destructive) { etat.aSupprimer = e }
                    }
                    if etat.ouverts.contains(e.id) { detail(e) }
                }
                .padding(12)
                .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 10))
            }
        }
    }

    @ViewBuilder private func detail(_ e: EnregistrementResume) -> some View {
        if let d = modele.details[e.id] {
            VStack(alignment: .leading, spacing: 8) {
                if let r = d.resume, !r.isEmpty {
                    Text("Résumé").font(.caption.bold())
                    Text(r).textSelection(.enabled).font(.callout)
                }
                if let t = d.transcript, !t.isEmpty {
                    Text("Texte").font(.caption.bold())
                    Text(t).textSelection(.enabled).font(.callout.monospaced())
                } else {
                    Text("Pas encore de texte.").foregroundStyle(.secondary)
                }
            }
        } else {
            ProgressView().controlSize(.small)
        }
    }

    private func basculer(_ e: EnregistrementResume) {
        if etat.ouverts.contains(e.id) { etat.ouverts.remove(e.id) } else {
            etat.ouverts.insert(e.id)
            modele.chargerDetail(e.id)
        }
    }

    private func heure(_ d: Date) -> String {
        let f = DateFormatter()
        f.dateFormat = "HH:mm"
        return f.string(from: d)
    }

    private func jour(_ d: Date) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "fr_FR")
        f.dateFormat = "EEE d MMM, HH:mm"
        return f.string(from: d)
    }
}
