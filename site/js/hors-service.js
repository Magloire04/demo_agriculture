// Page d'attente : demande l'état du site toutes les 30 secondes et recharge la
// page dès qu'AgriFon est remis en service. Tant qu'il est coupé, rien ne bouge
// (pas de rechargement qui ferait relire la page à un lecteur d'écran).
const ATTENTE_MS = 30_000;

async function verifier() {
  if (document.hidden) return;
  try {
    const reponse = await fetch('api/etat', { cache: 'no-store' });
    const etat = await reponse.json();
    if (reponse.ok && etat.hors_service === false) location.reload();
  } catch {
    // réseau absent : nouvel essai au prochain tour
  }
}

setInterval(verifier, ATTENTE_MS);
document.addEventListener('visibilitychange', verifier);
