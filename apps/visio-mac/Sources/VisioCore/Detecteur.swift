import Foundation

// Les applis dont l'usage du micro signale une réunion : visio, navigateurs (Meet, Teams web),
// messageries. Tout le reste (dictée, services du système) est ignoré.
private let racinesDeReunion = [
    "us.zoom.xos", "com.microsoft.teams", "com.microsoft.teams2", "com.google.Chrome", "com.apple.Safari", "com.apple.FaceTime",
    "company.thebrowser.Browser", "com.microsoft.edgemac", "org.mozilla.firefox", "com.brave.Browser",
    "com.tinyspeck.slackmacgap", "com.cisco.webexmeetingsapp", "com.hnc.Discord", "com.skype.skype",
    "net.whatsapp.WhatsApp", "com.webex.meetingmanager", "com.logmein.GoToMeeting",
]

public func appsDeReunion(_ bundles: [String]) -> [String] {
    bundles.filter { b in racinesDeReunion.contains { b == $0 || b.hasPrefix($0 + ".") } }
}

public enum ActionDetecteur: Equatable, Sendable {
    case proposer([String])
    case arreter
}

// Décide, à partir d'échantillons réguliers des applis qui utilisent le micro, quand proposer un
// enregistrement et quand l'arrêter. Un enregistrement lancé sans réunion détectée n'est jamais
// arrêté automatiquement : seul Marc l'arrête.
public struct Detecteur: Sendable {
    public var delaiProposition: TimeInterval = 8
    public var delaiFin: TimeInterval = 30
    private var vuDepuis: Date?
    private var absentDepuis: Date?
    private var propose = false
    private var reunionVue = false

    public init() {}

    public mutating func echantillon(apps: [String], enregistre: Bool, maintenant: Date) -> ActionDetecteur? {
        if enregistre {
            vuDepuis = nil
            if !apps.isEmpty {
                reunionVue = true
                absentDepuis = nil
            } else if reunionVue {
                absentDepuis = absentDepuis ?? maintenant
                if maintenant.timeIntervalSince(absentDepuis!) >= delaiFin {
                    reunionVue = false
                    absentDepuis = nil
                    return .arreter
                }
            }
            return nil
        }
        reunionVue = false
        absentDepuis = nil
        if apps.isEmpty {
            vuDepuis = nil
            propose = false
            return nil
        }
        vuDepuis = vuDepuis ?? maintenant
        if !propose, maintenant.timeIntervalSince(vuDepuis!) >= delaiProposition {
            propose = true
            return .proposer(apps)
        }
        return nil
    }
}
