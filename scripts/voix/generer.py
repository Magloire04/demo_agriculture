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
import tempfile
import unicodedata

import scipy.io.wavfile
import torch
from transformers import AutoTokenizer, VitsModel

MODELE = "facebook/mms-tts-fon"
# Le modèle ne connaît que l'accent aigu et le caron : les autres accents (grave)
# sont retirés, la ponctuation devient une pause.
ACCENTS_CONNUS = {"́", "̌"}


def preparer(texte, vocabulaire):
    sortie = []
    for c in unicodedata.normalize("NFC", texte.lower()):
        if c in vocabulaire:
            sortie.append(c)
            continue
        d = unicodedata.normalize("NFD", c)
        if d[0] in vocabulaire:
            sortie.append(d[0] + "".join(m for m in d[1:] if m in ACCENTS_CONNUS))
        elif c in ".,;:?!":
            sortie.append(" ")
    return unicodedata.normalize("NFC", "".join(sortie)).strip()


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("liste")
    p.add_argument("dossier")
    p.add_argument("--graine", type=int, default=1, help="le rendu varie d'une graine à l'autre")
    p.add_argument("--refaire", nargs="*", default=[], help="fichiers à regénérer même s'ils existent")
    args = p.parse_args()

    with open(args.liste, encoding="utf-8") as f:
        liste = json.load(f)
    a_faire = [x for x in liste if x["fichier"] in args.refaire or not os.path.exists(os.path.join(args.dossier, x["fichier"]))]
    print(f"{len(a_faire)} extraits à générer sur {len(liste)}.")
    if not a_faire:
        return

    tokenizer = AutoTokenizer.from_pretrained(MODELE)
    modele = VitsModel.from_pretrained(MODELE)
    vocabulaire = {k for k in tokenizer.get_vocab() if len(k) == 1}
    os.makedirs(args.dossier, exist_ok=True)

    for i, x in enumerate(a_faire, 1):
        entree = tokenizer(preparer(x["texte"], vocabulaire), return_tensors="pt")
        torch.manual_seed(args.graine)
        with torch.no_grad():
            onde = modele(**entree).waveform[0].numpy()
        with tempfile.NamedTemporaryFile(suffix=".wav") as wav:
            scipy.io.wavfile.write(wav.name, modele.config.sampling_rate, onde)
            subprocess.run(
                ["ffmpeg", "-loglevel", "error", "-y", "-i", wav.name, "-ac", "1", "-b:a", "40k",
                 os.path.join(args.dossier, x["fichier"])],
                check=True,
            )
        print(f"{i}/{len(a_faire)}  {x['fichier']}  {x['texte']}")


if __name__ == "__main__":
    main()
