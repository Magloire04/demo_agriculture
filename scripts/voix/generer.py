"""Génère les extraits audio manquants de public/voix avec la voix de synthèse fon
de Meta (MMS-TTS, facebook/mms-tts-fon, licence CC BY-NC 4.0).

À lancer sur un poste, pas sur l'hébergement :

    pip install torch transformers scipy        (et ffmpeg installé)
    node scripts/lister-voix.js --json liste.json
    python3 scripts/voix/generer.py liste.json public/voix
    python3 scripts/voix/generer.py liste.json public/voix --graine 3 --refaire a1b2c3d4e5f60718.mp3

Un extrait déjà présent n'est pas regénéré (sauf --refaire) : un enregistrement
humain déposé sous le même nom est donc conservé.
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile
import unicodedata

import scipy.io.wavfile
import torch
from transformers import AutoTokenizer, VitsModel

MODELE = "facebook/mms-tts-fon"
# Le modèle ne connaît que l'accent aigu et le caron : les autres accents (grave)
# sont retirés, la ponctuation devient une pause. Il n'a pas de « r » : on le dit
# « l », comme en fon (« lǐtli » pour litre).
ACCENTS_CONNUS = {"\u0301", "\u030c"}  # aigu, caron
PONCTUATION = ".,;:?!"


def preparer(texte, vocabulaire):
    """Rend le texte à donner au modèle et les caractères qu'il a fallu retirer."""
    sortie, perdus = [], set()
    for c in unicodedata.normalize("NFC", texte.lower().replace("r", "l")):
        if c in vocabulaire:
            sortie.append(c)
            continue
        d = unicodedata.normalize("NFD", c)
        if d[0] in vocabulaire:
            gardes = "".join(m for m in d[1:] if m in ACCENTS_CONNUS)
            compose = unicodedata.normalize("NFC", d[0] + gardes)
            # La lettre accentuée d'un seul tenant si le modèle la connaît, sinon lettre puis accent.
            sortie.append(compose if compose in vocabulaire else d[0] + gardes)
        elif c in PONCTUATION:
            sortie.append(" ")
        elif unicodedata.combining(c):
            continue  # ton bas (accent grave) : le modèle ne le marque pas
        elif not c.isspace():
            perdus.add(c)
        else:
            sortie.append(" ")
    return " ".join("".join(sortie).split()), perdus


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("liste")
    p.add_argument("dossier")
    p.add_argument("--graine", type=int, default=1, help="le rendu varie d'une graine à l'autre")
    p.add_argument("--refaire", nargs="*", default=[], help="fichiers à regénérer même s'ils existent")
    args = p.parse_args()

    with open(args.liste, encoding="utf-8") as f:
        liste = json.load(f)
    refaire = {os.path.basename(n) if n.endswith(".mp3") else os.path.basename(n) + ".mp3" for n in args.refaire}
    inconnus = refaire - {x["fichier"] for x in liste}
    if inconnus:
        sys.exit(f"Absents de la liste : {', '.join(sorted(inconnus))}")
    a_faire = [x for x in liste if x["fichier"] in refaire or not os.path.exists(os.path.join(args.dossier, x["fichier"]))]
    print(f"{len(a_faire)} extraits à générer sur {len(liste)}.")
    if not a_faire:
        return

    tokenizer = AutoTokenizer.from_pretrained(MODELE)
    modele = VitsModel.from_pretrained(MODELE)
    vocabulaire = {k for k in tokenizer.get_vocab() if len(k) == 1}
    os.makedirs(args.dossier, exist_ok=True)

    with tempfile.TemporaryDirectory() as temporaire:
        wav = os.path.join(temporaire, "extrait.wav")
        for i, x in enumerate(a_faire, 1):
            texte, perdus = preparer(x["texte"], vocabulaire)
            if perdus:
                print(f"  attention : {''.join(sorted(perdus))} non prononçable(s) dans « {x['texte']} »")
            torch.manual_seed(args.graine)
            with torch.no_grad():
                onde = modele(**tokenizer(texte, return_tensors="pt")).waveform[0].numpy()
            scipy.io.wavfile.write(wav, modele.config.sampling_rate, onde)
            subprocess.run(
                ["ffmpeg", "-loglevel", "error", "-y", "-i", wav, "-ac", "1", "-b:a", "40k",
                 os.path.join(args.dossier, x["fichier"])],
                check=True,
            )
            print(f"{i}/{len(a_faire)}  {x['fichier']}  {x['texte']}")


if __name__ == "__main__":
    main()
