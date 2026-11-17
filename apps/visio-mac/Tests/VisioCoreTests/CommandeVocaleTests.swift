import Testing
@testable import VisioCore

@Suite struct CommandeVocaleTests {
    @Test(arguments: ["arrête l'enregistrement", "Arrête l'enregistrement.", "stop enregistrement",
                      "ok, fin de l'enregistrement", "stoppe l'enregistrement", "termine l'enregistrement s'il te plaît",
                      "ARRETE ENREGISTREMENT"])
    func reconnaitLaPhraseDArret(texte: String) {
        #expect(contientCommandeArret(texte))
    }

    @Test(arguments: ["stop", "on arrête là pour aujourd'hui", "l'enregistrement est lancé",
                      "je voulais parler de l'enregistrement du devis", "", "arrête"])
    func neReagitPasAuxPhrasesOrdinaires(texte: String) {
        #expect(!contientCommandeArret(texte))
    }
}
