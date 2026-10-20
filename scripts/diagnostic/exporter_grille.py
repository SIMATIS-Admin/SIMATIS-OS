#!/usr/bin/env python3
"""Exporte l'onglet « Grille de scoring » du classeur EnduroDiag en JSON pour l'OS.

Bibliothèque standard seulement. Usage : python3 exporter_grille.py CLASSEUR.xlsx SORTIE.json
"""
import json
import re
import sys
import xml.etree.ElementTree as ET
import zipfile

NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
RNS = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
PKG = '{http://schemas.openxmlformats.org/package/2006/relationships}'
FEUILLE = 'Grille de scoring'
DIMENSIONS = {
    'Outils & Méthode': 'outils',
    'Stratégie, régularité & endurance': 'strategie',
    'Polyvalence': 'polyvalence',
}
# Seuil de passage par défaut ; à modifier dans le JSON si Marc change le seuil.
SEUIL = 6


def lire_feuille(zf, nom):
    classeur = ET.fromstring(zf.read('xl/workbook.xml'))
    rid = next((s.get(RNS + 'id') for s in classeur.iter(NS + 'sheet') if s.get('name') == nom), None)
    if rid is None:
        raise SystemExit(f'Onglet « {nom} » introuvable dans le classeur.')
    rels = ET.fromstring(zf.read('xl/_rels/workbook.xml.rels'))
    cible = next(r.get('Target') for r in rels.iter(PKG + 'Relationship') if r.get('Id') == rid)
    chemin = cible.lstrip('/') if cible.startswith('/') else 'xl/' + cible
    return ET.fromstring(zf.read(chemin))


def chaines_partagees(zf):
    try:
        racine = ET.fromstring(zf.read('xl/sharedStrings.xml'))
    except KeyError:
        return []
    return [''.join(t.text or '' for t in si.iter(NS + 't')) for si in racine.iter(NS + 'si')]


def valeurs(feuille, partagees):
    lignes = {}
    for ligne in feuille.iter(NS + 'row'):
        cellules = {}
        for c in ligne.findall(NS + 'c'):
            colonne = re.match(r'[A-Z]+', c.get('r')).group(0)
            v = c.find(NS + 'v')
            en_ligne = c.find(NS + 'is')
            if c.get('t') == 's' and v is not None:
                val = partagees[int(v.text)]
            elif c.get('t') == 'inlineStr' and en_ligne is not None:
                val = ''.join(t.text or '' for t in en_ligne.iter(NS + 't'))
            else:
                val = (v.text or '') if v is not None else ''
            cellules[colonne] = val
        lignes[int(ligne.get('r'))] = cellules
    return lignes


def main():
    if len(sys.argv) != 3:
        raise SystemExit('Usage : python3 exporter_grille.py CLASSEUR.xlsx SORTIE.json')
    try:
        zf = zipfile.ZipFile(sys.argv[1])
    except (FileNotFoundError, zipfile.BadZipFile):
        raise SystemExit(f'Classeur illisible : {sys.argv[1]}')
    lignes = valeurs(lire_feuille(zf, FEUILLE), chaines_partagees(zf))
    questions = []
    for numero, c in sorted(lignes.items()):
        if numero == 1 or not c.get('C', '').strip():
            continue
        dimension = DIMENSIONS.get(c.get('A', '').strip())
        if dimension is None:
            raise SystemExit(f'Ligne {numero} : dimension inconnue « {c.get("A", "")} ».')
        questions.append({
            'section': c.get('B', '').strip(),
            'numero': int(float(c['C'])),
            'libelle': c.get('D', '').strip(),
            'dimension': dimension,
            'poids': float(c.get('E', '0')),
        })
    with open(sys.argv[2], 'w', encoding='utf8') as f:
        json.dump({'seuil': SEUIL, 'questions': questions}, f, ensure_ascii=False, indent=2)
    print(f'{len(questions)} questions écrites dans {sys.argv[2]}')


if __name__ == '__main__':
    main()
