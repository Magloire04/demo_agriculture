// Point d'entrée pour les hébergeurs qui chargent l'application avec require()
// (cPanel « Setup Node.js App », Passenger, LiteSpeed). Le serveur est un module ES.
import('./server/index.js')
  .then(({ demarrer }) => demarrer())
  .catch((erreur) => {
    console.error(erreur);
    process.exit(1);
  });
