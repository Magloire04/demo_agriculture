#!/usr/bin/env bash
# Lance en arrière-plan la préparation de la voix des réponses
# (scripts/voix/preparer-phrases.js) et rend la main aussitôt. Appelé après chaque
# import des prix : par scripts/importer-prix.sh et par « Importer maintenant » du
# back office. Journal : stockage/voix-phrases/preparation.log.
#
# Une seule préparation à la fois : flock fait attendre la suivante, et le verrou
# tombe avec le processus, même tué. NODE : le node à utiliser (par défaut celui du PATH).

set -euo pipefail

RACINE=$(cd "$(dirname "$0")/../.." && pwd)
cd "$RACINE"
mkdir -p stockage/voix-phrases

verrou=()
if command -v flock >/dev/null; then
  verrou=(flock stockage/voix-phrases/preparation.verrou)
fi
# ${verrou[@]+…} : un tableau vide sous « set -u » fait échouer les bash anciens.
(nohup ${verrou[@]+"${verrou[@]}"} "${NODE:-node}" scripts/voix/preparer-phrases.js </dev/null >>stockage/voix-phrases/preparation.log 2>&1 &)
echo "Préparation de la voix lancée en arrière-plan (journal : stockage/voix-phrases/preparation.log)."
