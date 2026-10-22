"""Extrait la liste régionale des pesticides autorisés par le COAHP vers
data/pesticides.json, pour vérifier qu'un traitement nommé par AgriFon porte
un produit autorisé (server/pesticides.js).

À lancer sur un poste, pas sur l'hébergement :

    pip install pypdf
    python scripts/pesticides/extraire_coahp.py liste-coahp.pdf data/pesticides.json

Liste source (version 2023, publiée en août 2026, 844 produits) :
https://insah.cilss.int/wp-content/uploads/2026/08/1ere-liste-regionale_COAHP-Version-2023_13-08-2026.pdf

Les usages de la liste sont des phrases (« Insecticide autorisé contre
Helicoverpa armigera et Tuta absoluta en culture de la tomate. ») : le script
garde la phrase et y repère les cultures du lexique et les groupes de cultures.
Un groupe n'est relié aux cultures que dans GROUPES, à compléter à la main.
"""

import json
import re
import sys

from pypdf import PdfReader

URL = "https://insah.cilss.int/wp-content/uploads/2026/08/1ere-liste-regionale_COAHP-Version-2023_13-08-2026.pdf"

# Mots de la liste -> identifiants du lexique AgriFon (data/lexique.json).
CULTURES = {
    r"\bmaïs\b": "mais", r"\briz\b": "riz", r"\bcotonniers?\b": "coton", r"\bcoton\b": "coton", r"\bcotonnière\b": "coton",
    r"\btomates?\b": "tomate", r"\boignons?\b": "oignon", r"\bpiments?\b": "piment", r"\bgombos?\b": "gombo",
    r"\bniébé\b": "haricot", r"\bharicots?\b": "haricot", r"\barachides?\b": "arachide", r"\bsoja\b": "soja",
    r"\bsorgho\b": "sorgho", r"\bignames?\b": "igname", r"\bmanioc\b": "manioc", r"\bananas\b": "ananas",
    r"\banacardiers?\b": "anacarde", r"\banacarde\b": "anacarde", r"\bpalmiers?\b": "palmier",
    r"\bbananiers?\b": "plantain", r"\bplantains?\b": "plantain", r"\bamarantes?\b": "amarante", r"\bgboma\b": "gboma",
}

# Groupes repérés dans les usages et cultures qu'ils couvrent. Un groupe absent ou
# vide ne couvre aucune culture : la règle d'autorisation reste stricte.
GROUPES_REPERES = {
    r"cultures? maraîch|cultures? maraich|maraîchage": "cultures maraîchères",
    r"légumineuses": "légumineuses",
    r"céréales": "céréales",
    r"cultures? vivrières": "cultures vivrières",
    r"cultures? fruitières|vergers": "cultures fruitières",
}
GROUPES = {
    "cultures maraîchères": ["tomate", "piment", "gombo", "oignon", "gboma", "amarante"],
    "légumineuses": ["haricot", "arachide", "soja"],
    "céréales": ["mais", "riz", "sorgho"],
    "cultures vivrières": [],
    "cultures fruitières": [],
}

INTERDITS = [
    {"matiere": "endosulfan", "texte": "arrêté interministériel n° 447 du 5 novembre 2009"},
    {"matiere": "dichlorvos", "texte": "rappel du Conseil des ministres du 1er juillet 2026"},
] + [
    {"matiere": m, "texte": "polluant organique persistant (convention de Stockholm)"}
    for m in ["DDT", "aldrine", "dieldrine", "chlordane", "heptachlore", "mirex", "toxaphène"]
]

# « 14.  ACETIN 56 EC … », ou le numéro seul sur sa ligne et le nom à la suivante.
DEBUT = re.compile(r"^(\d+)\.(?:\s{2,}(.*))?$")
ENTETES = re.compile(
    r"^(Page \d+ sur \d+|N° Spécialité|OMS Firme|actif\(s\) et|N° Product|class Firm|agent\(s\) and)"
)
CLASSE = re.compile(r"\s(Ia|Ib|II|III|U)\s")
TYPE_USAGE = re.compile(
    r"(Bio\s*-?\s*)?(Insecticide|Herbicide|Fongicide|Nématicide|Acaricide|Rodenticide|Raticide|Molluscicide|"
    r"Régulateur|Fumigant|Bactéricide|Larvicide|Adjuvant|Stimulateur|Avicide|Répulsif)",
    re.I,
)
SUBSTANCE = re.compile(r"\(([^()]*\d[^()]*)\)")


def enregistrements(texte):
    courant = None
    for ligne in texte.splitlines():
        ligne = ligne.strip()
        if not ligne or ENTETES.match(ligne):
            continue
        m = DEBUT.match(ligne)
        if m:
            if courant:
                yield courant
            courant = [int(m.group(1)), m.group(2) or ""]
        elif courant:
            courant[1] += " " + ligne
    if courant:
        yield courant


def nom_substance(avant):
    """Mots qui précèdent la parenthèse et portent une minuscule : le nom de la
    substance, sans le nom de la firme (en capitales) qui le précède."""
    mots = avant.split()
    garde = []
    for mot in reversed(mots):
        if not re.search(r"[a-zà-ÿµ]", mot):
            break
        garde.append(mot)
    return " ".join(reversed(garde)).strip(" ,+")


def analyser(numero, texte):
    texte = re.sub(r"\s+", " ", texte).strip()
    classe = CLASSE.search(" " + texte + " ")
    nom = texte[: classe.start()].strip() if classe else texte.split(" ")[0]
    reste = texte[classe.end() - 1 :] if classe else texte
    usage = TYPE_USAGE.search(reste)
    partie_substances = reste[: usage.start()] if usage else reste
    texte_usage = reste[usage.start() :].strip() if usage else ""
    matieres = []
    for morceau in partie_substances.split("+"):
        m = SUBSTANCE.search(morceau)
        if m:
            matieres.append({"nom": nom_substance(morceau[: m.start()]), "concentration": m.group(1).strip()})
    bas = texte_usage.lower()
    cultures = sorted({c for motif, c in CULTURES.items() if re.search(motif, bas)})
    groupes = sorted({g for motif, g in GROUPES_REPERES.items() if re.search(motif, bas)})
    return {
        "numero": numero,
        "nom": nom,
        "matieres": matieres,
        "usages": [{"texte": texte_usage, "cultures": cultures, "groupes": groupes}],
        "autorisation": {"type": "homologation", "fin": None},
    }


def principal(pdf, sortie):
    lecteur = PdfReader(pdf)
    texte = "\n".join(page.extract_text() for page in lecteur.pages)
    produits = [analyser(n, t) for n, t in enregistrements(texte)]
    donnees = {
        "liste": {
            "titre": "Première liste régionale des pesticides autorisés par le COAHP, version 2023",
            "url": URL,
            "date": "2026-08-13",
        },
        "groupes": GROUPES,
        "produits": produits,
        "interdits": INTERDITS,
    }
    with open(sortie, "w", encoding="utf-8") as f:
        json.dump(donnees, f, ensure_ascii=False, indent=1)
        f.write("\n")
    sans_matiere = [p["numero"] for p in produits if not p["matieres"]]
    print(f"{len(produits)} produits écrits dans {sortie}.")
    if sans_matiere:
        print(f"Sans matière active reconnue ({len(sans_matiere)}) : {sans_matiere[:20]}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("Usage : python scripts/pesticides/extraire_coahp.py <liste.pdf> <sortie.json>")
    principal(sys.argv[1], sys.argv[2])
