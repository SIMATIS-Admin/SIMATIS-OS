import CoreAudio
import Foundation

private func propriete<T>(_ objet: AudioObjectID, _ selecteur: AudioObjectPropertySelector, _ vide: T) -> T? {
    var adresse = AudioObjectPropertyAddress(mSelector: selecteur, mScope: kAudioObjectPropertyScopeGlobal,
                                             mElement: kAudioObjectPropertyElementMain)
    var valeur = vide
    var taille = UInt32(MemoryLayout<T>.size)
    return AudioObjectGetPropertyData(objet, &adresse, 0, nil, &taille, &valeur) == noErr ? valeur : nil
}

// Les identifiants des applis qui utilisent le micro en ce moment, sauf cette appli. Aucune
// autorisation n'est nécessaire : macOS l'affiche déjà dans le point orange de la barre de menus.
public func applisUtilisantLeMicro() -> [String] {
    var adresse = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyProcessObjectList,
                                             mScope: kAudioObjectPropertyScopeGlobal,
                                             mElement: kAudioObjectPropertyElementMain)
    var taille: UInt32 = 0
    let systeme = AudioObjectID(kAudioObjectSystemObject)
    guard AudioObjectGetPropertyDataSize(systeme, &adresse, 0, nil, &taille) == noErr else { return [] }
    var ids = [AudioObjectID](repeating: 0, count: Int(taille) / MemoryLayout<AudioObjectID>.size)
    guard AudioObjectGetPropertyData(systeme, &adresse, 0, nil, &taille, &ids) == noErr else { return [] }
    let moi = ProcessInfo.processInfo.processIdentifier
    return ids.compactMap { id in
        guard (propriete(id, kAudioProcessPropertyIsRunningInput, UInt32(0)) ?? 0) != 0,
              (propriete(id, kAudioProcessPropertyPID, Int32(0)) ?? moi) != moi,
              let bundle: Unmanaged<CFString> = propriete(id, kAudioProcessPropertyBundleID, Optional<Unmanaged<CFString>>.none) ?? nil
        else { return nil }
        return bundle.takeUnretainedValue() as String
    }
}
